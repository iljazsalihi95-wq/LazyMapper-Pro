package com.lazymapper.admin;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.graphics.Bitmap;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private static final int FILE_PICKER=3001;
  private final ExecutorService io=Executors.newFixedThreadPool(3);
  private boolean trustedPage=false;
  public class NativeHttp {
    @JavascriptInterface public String configureBackend(String base,String token){
      if(!trustedPage)return "UNTRUSTED";
      try{NativeJobs.configure(MainActivity.this,base,token);return "OK";}catch(Exception e){return "CONFIGURATION ERROR";}
    }
    @JavascriptInterface public String enqueueAnalysis(String url,String name){
      if(!trustedPage)return "UNTRUSTED";
      try{return NativeJobs.enqueue(MainActivity.this,url,name);}catch(Exception e){return "QUEUE ERROR";}
    }
    @JavascriptInterface public void logoutBackend(){
      if(trustedPage)NativeJobs.logout(MainActivity.this);
    }

    @JavascriptInterface public void preview(String url,String title,String mode){
      if(!trustedPage)return;
      try {
        Uri uri=Uri.parse(url);
        if(!"http".equalsIgnoreCase(uri.getScheme())&&!"https".equalsIgnoreCase(uri.getScheme()))return;
        runOnUiThread(()->{
          Intent i=new Intent(MainActivity.this,PreviewActivity.class);
          i.putExtra("url",url);i.putExtra("title",title);i.putExtra("mode",mode);
          startActivity(i);
        });
      } catch(Exception ignored){}
    }
    @JavascriptInterface public void probe(String url,String requestId){
      if(!trustedPage)return;
      io.execute(()->{
        String state="UNKNOWN";HttpURLConnection c=null;
        try{
          URL u=new URL(url);String protocol=u.getProtocol();
          if(!"http".equalsIgnoreCase(protocol)&&!"https".equalsIgnoreCase(protocol))throw new Exception("Unsupported URL");
          c=(HttpURLConnection)u.openConnection();
          c.setConnectTimeout(7000);c.setReadTimeout(7000);c.setInstanceFollowRedirects(true);
          c.setRequestProperty("User-Agent","VLC/3.0.20 LibVLC/3.0.20");
          c.setRequestProperty("Range","bytes=0-1023");
          int status=c.getResponseCode();
          if(status==401||status==403)state="AUTH REQUIRED";
          else if(status==451)state="UNKNOWN";
          else if(status==404||status==410)state="UNAVAILABLE";
          else if(status==200||status==206){
            String ct=c.getContentType();ct=ct==null?"":ct.toLowerCase();
            if(!ct.contains("text/html")){
              InputStream in=c.getInputStream();byte[] sample=new byte[1024];int n=in.read(sample);in.close();
              // Receiving bytes is not a playback test.
              if(n>0)state="UNKNOWN";
            }
          }
        }catch(java.net.SocketTimeoutException timeout){state="TIMEOUT";}catch(Exception ignored){}finally{if(c!=null)c.disconnect();}
        JSONObject obj=new JSONObject();try{obj.put("state",state);}catch(Exception ignored){}
        String js="window.LazyMapperProbeReply&&window.LazyMapperProbeReply("+JSONObject.quote(requestId)+","+obj.toString()+")";
        runOnUiThread(()->{if(trustedPage&&web!=null)web.evaluateJavascript(js,null);});
      });
    }
    @JavascriptInterface public void getM3u(String url,String requestId){
      if(!trustedPage)return;
      io.execute(()->{
        JSONObject reply=new JSONObject();HttpURLConnection c=null;
        try{
          URL u=new URL(url);String scheme=u.getProtocol();
          if(!"http".equalsIgnoreCase(scheme)&&!"https".equalsIgnoreCase(scheme))throw new Exception("Lejohen vetëm HTTP/HTTPS");
          c=(HttpURLConnection)u.openConnection();c.setConnectTimeout(15000);c.setReadTimeout(45000);c.setInstanceFollowRedirects(true);
          c.setRequestProperty("User-Agent","Mozilla/5.0 (Android) LazyMapper/1.0");
          int status=c.getResponseCode();if(status<200||status>=300)throw new Exception("HTTP "+status);
          InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;
          while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>25*1024*1024)throw new Exception("M3U mbi 25 MB");}
          reply.put("ok",true);reply.put("text",out.toString("UTF-8"));
        }catch(Exception e){try{reply.put("ok",false);reply.put("error",e.getMessage()==null?"Gabim rrjeti":e.getMessage());}catch(Exception ignored){}}
        finally{if(c!=null)c.disconnect();}
        final String js="window.LazyMapperNativeReply&&window.LazyMapperNativeReply("+JSONObject.quote(requestId)+","+reply.toString()+")";
        runOnUiThread(()->{if(trustedPage&&web!=null)web.evaluateJavascript(js,null);});
      });
    }
  }
  @Override public void onCreate(Bundle b) {
    super.onCreate(b);
    web = new WebView(this);
    setContentView(web);
    WebSettings s=web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setAllowFileAccess(true);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    web.addJavascriptInterface(new NativeHttp(),"LazyMapperNative");
    web.setWebViewClient(new WebViewClient(){
      @Override public void onPageStarted(WebView view,String url,Bitmap favicon){trustedPage="file:///android_asset/index.html".equals(url);}
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        Uri u=request.getUrl();if("file".equals(u.getScheme())&&"/android_asset/index.html".equals(u.getPath()))return false;
        try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        fileCallback=callback;
        try{Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"audio/x-mpegurl","application/vnd.apple.mpegurl","text/plain","application/octet-stream"});startActivityForResult(Intent.createChooser(intent,"Zgjidh M3U"),FILE_PICKER);return true;}
        catch(Exception e){fileCallback=null;return false;}
      }
    });
    trustedPage=true;
    web.loadUrl("file:///android_asset/index.html");
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode==FILE_PICKER&&fileCallback!=null){Uri[] out=(resultCode==RESULT_OK&&data!=null&&data.getData()!=null)?new Uri[]{data.getData()}:null;fileCallback.onReceiveValue(out);fileCallback=null;}
  }
  @Override protected void onDestroy(){
    io.shutdownNow();
    if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}
    if(web!=null){web.removeJavascriptInterface("LazyMapperNative");web.destroy();web=null;}
    super.onDestroy();
  }
  @Override public void onBackPressed() {
    if(web!=null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}

