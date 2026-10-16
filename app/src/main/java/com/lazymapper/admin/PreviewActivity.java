package com.lazymapper.admin;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

public class PreviewActivity extends Activity {
  private ExoPlayer player;
  private PlayerView view;
  private TextView status;
  private String url;
  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    url=getIntent().getStringExtra("url");
    String title=getIntent().getStringExtra("title");
    String mode=getIntent().getStringExtra("mode");
    LinearLayout root=new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(12,12,12,12);
    root.setBackgroundColor(0xff061526);
    TextView heading=new TextView(this);
    heading.setText(title==null?"Preview":title);
    heading.setTextColor(0xffffffff);heading.setTextSize(18);
    root.addView(heading);
    view=new PlayerView(this);
    root.addView(view,new LinearLayout.LayoutParams(-1,0,1));
    status=new TextView(this);status.setTextColor(0xffffd47b);status.setText("Pritet testi real i videos...");
    root.addView(status);
    LinearLayout controls=new LinearLayout(this);
    for(String kind:new String[]{"AUTO","HLS","MPEG-TS","DASH"}){
      Button b=new Button(this);b.setText(kind);b.setTextSize(10);
      b.setOnClickListener(v->play(kind));
      controls.addView(b,new LinearLayout.LayoutParams(0,-2,1));
    }
    root.addView(controls);
    Button close=new Button(this);close.setText("MBYLL PREVIEW");close.setOnClickListener(v->finish());root.addView(close);
    setContentView(root);
    if(url==null||!(url.startsWith("http://")||url.startsWith("https://"))){status.setText("URL e pavlefshme");return;}
    play(mode==null?"AUTO":mode);
  }
  private void play(String kind){
    if(player!=null){view.setPlayer(null);player.release();player=null;}
    status.setText("DUKE TESTUAR • "+kind);
    player=new ExoPlayer.Builder(this).build();
    view.setPlayer(player);
    player.addListener(new Player.Listener(){
      @Override public void onPlaybackStateChanged(int state){
        if(state==Player.STATE_READY)status.setText("READY • "+kind+" • video u përgatit (kontrollo figurën dhe zërin)");
        else if(state==Player.STATE_BUFFERING)status.setText("BUFFERING • "+kind);
        else if(state==Player.STATE_ENDED)status.setText("PËRFUNDOI • "+kind);
      }
      @Override public void onPlayerError(PlaybackException error){
        status.setText("GABIM • "+kind+" • "+error.getErrorCodeName()+": "+error.getMessage());
      }
    });
    MediaItem.Builder item=new MediaItem.Builder().setUri(Uri.parse(url));
    if("HLS".equals(kind))item.setMimeType(MimeTypes.APPLICATION_M3U8);
    else if("DASH".equals(kind))item.setMimeType(MimeTypes.APPLICATION_MPD);
    else if("MPEG-TS".equals(kind))item.setMimeType(MimeTypes.VIDEO_MP2T);
    player.setMediaItem(item.build());player.prepare();player.play();
  }
  @Override protected void onStop(){super.onStop();if(player!=null){view.setPlayer(null);player.release();player=null;}}
}