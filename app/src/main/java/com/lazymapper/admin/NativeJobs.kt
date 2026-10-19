package com.lazymapper.admin

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URI
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** WorkManager database contains only opaque references, never tokens or signed URLs. */
class JobVault(private val context: Context) {
    private fun key(): SecretKey = synchronized(JobVault::class.java) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey("LazyMapperJobsV1", null) as? SecretKey
        existing ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("LazyMapperJobsV1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    fun save(id: String, value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        check(context.getSharedPreferences("private_jobs", Context.MODE_PRIVATE).edit()
            .putString(id, Base64.encodeToString(bytes, Base64.NO_WRAP)).commit())
    }

    fun read(id: String): JSONObject? {
        val text = context.getSharedPreferences("private_jobs", Context.MODE_PRIVATE).getString(id, null) ?: return null
        val bytes = Base64.decode(text, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }

    fun clear() { context.getSharedPreferences("private_jobs", Context.MODE_PRIVATE).edit().clear().commit() }

    fun remove(id: String) {
        context.getSharedPreferences("private_jobs", Context.MODE_PRIVATE).edit().remove(id).commit()
    }
}

object NativeJobs {
    @JvmStatic fun configure(context: Context, base: String, token: String) {
        val uri = URI(base)
        require(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null && uri.query == null && uri.fragment == null)
        require(token.length >= 32)
        JobVault(context).save("backend", JSONObject().put("base", base.trimEnd('/')).put("token", token))
    }

    @JvmStatic fun logout(context: Context) {
        WorkManager.getInstance(context).cancelAllWorkByTag("mapper-private")
        JobVault(context).clear()
    }

    @JvmStatic fun enqueue(context: Context, url: String, name: String): String {
        require(URI(url).scheme in listOf("http", "https"))
        require(JobVault(context).read("backend") != null) { "Backend not configured" }
        val id = UUID.randomUUID().toString()
        JobVault(context).save(id, JSONObject().put("url", url).put("name", name.take(200)))
        val work = OneTimeWorkRequestBuilder<MapperWorker>()
            .setInputData(Data.Builder().putString("reference", id).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag("mapper-private").build()
        WorkManager.getInstance(context).enqueue(work)
        return work.id.toString()
    }
}

class MapperWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val id = inputData.getString("reference") ?: return Result.failure()
        val vault = JobVault(applicationContext)
        try {
            val config = vault.read("backend") ?: run { vault.remove(id); return Result.failure() }
            val job = vault.read(id) ?: return Result.failure()
            fun api(path: String, body: JSONObject? = null): JSONObject {
                val conn = URI(config.getString("base") + path).toURL().openConnection() as HttpURLConnection
                try {
                    conn.connectTimeout = 10000
                    conn.readTimeout = 12000
                    conn.instanceFollowRedirects = false // Never forward admin token to redirects.
                    conn.setRequestProperty("Authorization", "Bearer " + config.getString("token"))
                    if (body != null) {
                        conn.requestMethod = "POST"
                        conn.doOutput = true
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                    }
                    val status = conn.responseCode
                    if (status in listOf(401, 403)) throw SecurityException("AUTH REQUIRED")
                    check(status in 200..299)
                    val bytes = conn.inputStream.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(4096)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            out.write(buffer, 0, count)
                            check(out.size() <= 256 * 1024)
                        }
                        out.toByteArray()
                    }
                    return JSONObject(String(bytes, Charsets.UTF_8))
                } finally { conn.disconnect() }
            }
            var remote = job.optString("remoteId")
            if (remote.isEmpty()) {
                remote = api("/api/jobs", JSONObject().put("url", job.getString("url"))
                    .put("name", job.optString("name", "Stream"))).getString("id")
                job.put("remoteId", remote).remove("url")
                vault.save(id, job)
            }
            // Remote queue is authoritative; Android only waits for bounded periods.
            repeat(30) {
                if (isStopped) return Result.retry()
                val result = api("/api/jobs/$remote")
                if (result.optString("state") == "DONE") {
                    vault.remove(id)
                    return Result.success(Data.Builder()
                        .putString("remoteId", remote)
                        .putString("status", result.optJSONObject("result")?.optString("status", "UNKNOWN") ?: "UNKNOWN")
                        .build())
                }
                Thread.sleep(1000)
            }
            return if (runAttemptCount < 4) Result.retry() else Result.failure().also { vault.remove(id) }
        } catch (_: SecurityException) {
            vault.remove(id)
            return Result.failure()
        } catch (_: Exception) {
            return if (runAttemptCount < 4) Result.retry() else Result.failure().also { vault.remove(id) }
        }
    }
}
