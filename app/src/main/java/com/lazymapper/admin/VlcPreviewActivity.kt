package com.lazymapper.admin

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.net.Uri
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

/** Native LibVLC surface. No HTML player or external VLC application involved. */
class VlcPreviewActivity : Activity() {
    private var lib: LibVLC? = null
    private var player: MediaPlayer? = null
    private lateinit var surface: VLCVideoLayout
    private lateinit var status: TextView
    private var source: Uri? = null
    private var fill = false
    private var full = false

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        source = intent.getStringExtra("url")?.let { Uri.parse(it) }
            ?.takeIf { it.scheme in listOf("http", "https") }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xff061526.toInt())
        }
        val title = TextView(this).apply {
            text = intent.getStringExtra("title") ?: "LibVLC preview"
            setTextColor(-1)
            textSize = 18f
        }
        root.addView(title)
        surface = VLCVideoLayout(this)
        root.addView(surface, LinearLayout.LayoutParams(-1, 0, 1f))
        status = TextView(this).apply { setTextColor(0xffffd47b.toInt()); text = "NOT TESTED" }
        root.addView(status)
        val row = LinearLayout(this)
        fun button(text: String, action: () -> Unit) {
            row.addView(Button(this).apply { this.text = text; textSize = 10f; setOnClickListener { action() } },
                LinearLayout.LayoutParams(0, -2, 1f))
        }
        button("RETRY") { release(); start() }
        button("FIT/FILL") {
            fill = !fill
            player?.setAspectRatio(null)
            player?.setScale(if (fill) 1.0f else 0f)
        }
        button("AUDIO") { audioTracks() }
        button("SUBS") { subtitleTracks() }
        root.addView(row)
        root.addView(Button(this).apply {
            text = "FULLSCREEN"
            setOnClickListener {
                full = !full
                title.visibility = if (full) View.GONE else View.VISIBLE
                status.visibility = if (full) View.GONE else View.VISIBLE
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = if (full)
                    View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    else View.SYSTEM_UI_FLAG_VISIBLE
            }
        })
        root.addView(Button(this).apply { text = "MBYLL"; setOnClickListener { finish() } })
        setContentView(root)
    }

    private fun start() {
        val uri = source ?: run { status.text = "URL e pavlefshme"; return }
        val engine = LibVLC(this, arrayListOf("--network-caching=1500", "--no-video-title-show"))
        lib = engine
        val mediaPlayer = MediaPlayer(engine)
        player = mediaPlayer
        mediaPlayer.attachViews(surface, null, true, false)
        mediaPlayer.setEventListener { event ->
            runOnUiThread {
                if (player !== mediaPlayer) return@runOnUiThread
                status.text = when (event.type) {
                    MediaPlayer.Event.Playing -> "VLC PLAYING • kontrollo figurën dhe zërin"
                    MediaPlayer.Event.Buffering -> "BUFFERING ${event.buffering.toInt()}%"
                    MediaPlayer.Event.EncounteredError -> "VLC ERROR • playback dështoi"
                    MediaPlayer.Event.EndReached -> "PËRFUNDOI"
                    else -> status.text
                }
            }
        }
        val media = Media(engine, uri)
        mediaPlayer.media = media
        media.release()
        mediaPlayer.play()
    }

    private fun audioTracks() {
        val p = player ?: return
        val tracks = p.audioTracks ?: return
        AlertDialog.Builder(this).setTitle("Audio tracks")
            .setItems(tracks.map { it.name ?: "Audio ${it.id}" }.toTypedArray()) { _, which ->
                p.setAudioTrack(tracks[which].id)
            }.show()
    }

    private fun subtitleTracks() {
        val p = player ?: return
        val tracks = p.spuTracks ?: return
        AlertDialog.Builder(this).setTitle("Subtitle tracks")
            .setItems(tracks.map { it.name ?: "Subtitle ${it.id}" }.toTypedArray()) { _, which ->
                p.setSpuTrack(tracks[which].id)
            }.show()
    }

    private fun release() {
        player?.let { it.setEventListener(null); it.stop(); it.detachViews(); it.release() }
        player = null
        lib?.release()
        lib = null
    }

    override fun onStart() { super.onStart(); if (player == null) start() }
    override fun onStop() { release(); super.onStop() }
}
