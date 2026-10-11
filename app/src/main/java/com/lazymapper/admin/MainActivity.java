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

public class MainActivity extends Activity {
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private static final int FILE_PICKER=3001;
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
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        fileCallback=callback;
        try{Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"audio/x-mpegurl","application/vnd.apple.mpegurl","text/plain","application/octet-stream"});startActivityForResult(Intent.createChooser(intent,"Zgjidh M3U"),FILE_PICKER);return true;}
        catch(Exception e){fileCallback=null;return false;}
      }
    });
    web.loadUrl("file:///android_asset/index.html");
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode==FILE_PICKER&&fileCallback!=null){Uri[] out=(resultCode==RESULT_OK&&data!=null&&data.getData()!=null)?new Uri[]{data.getData()}:null;fileCallback.onReceiveValue(out);fileCallback=null;}
  }
  @Override public void onBackPressed() {
    if(web!=null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}
