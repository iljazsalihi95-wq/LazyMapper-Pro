package com.lazymapper.admin;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

public class NativePortalTest {
  private JSONObject input(String base,String action)throws Exception{return new JSONObject().put("portal",base+"/c/").put("mac","00:11:22:33:44:55").put("action",action).put("genre","1");}
  @Test public void connectsWithoutAdminKeyAndReusesIssuedSession()throws Exception {
    AtomicInteger handshakes=new AtomicInteger();
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/server/load.php",exchange->{
      String q=exchange.getRequestURI().getRawQuery(),body;
      if(q.contains("action=handshake")){handshakes.incrementAndGet();body="{\"js\":{\"token\":\"issued-fixture-token\"}}";}
      else if(!"Bearer issued-fixture-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))){exchange.sendResponseHeaders(401,-1);exchange.close();return;}
      else if(q.contains("action=get_genres"))body="{\"js\":[{\"id\":\"1\",\"title\":\"Fixture\"}]}";
      else body="{\"js\":{\"data\":[{\"id\":\"2\",\"name\":\"Channel\"}],\"total_items\":12,\"max_page_items\":5}}";
      byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
    });server.start();
    try {String base="http://127.0.0.1:"+server.getAddress().getPort();NativePortal client=new NativePortal();
      JSONObject genres=client.inspect(input(base,"genres"));assertTrue(genres.getBoolean("ok"));assertEquals("Fixture",genres.getJSONArray("genres").getJSONObject(0).getString("title"));
      JSONObject channels=client.inspect(input(base,"channels"));assertEquals(3,channels.getInt("max_page"));assertEquals(1,handshakes.get());assertFalse(genres.toString().contains("issued-fixture-token"));
    }finally{server.stop(0);}
  }
  @Test public void stopsOnAuthorizationAndRateLimitWithoutRetry()throws Exception {
    for(int code:new int[]{401,429}){AtomicInteger calls=new AtomicInteger();HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
      server.createContext("/server/load.php",e->{calls.incrementAndGet();e.sendResponseHeaders(code,-1);e.close();});server.start();
      try {new NativePortal().inspect(input("http://127.0.0.1:"+server.getAddress().getPort(),"genres"));fail("Must fail on HTTP "+code);}
      catch(SecurityException expected){assertEquals(1,calls.get());}finally{server.stop(0);}
    }
  }
  @Test public void rejectsInvalidDeviceAndActions()throws Exception {
    NativePortal client=new NativePortal();
    try{client.inspect(input("http://127.0.0.1:1","genres").put("mac","invalid"));fail();}catch(Exception expected){assertEquals("Device MAC invalid",expected.getMessage());}
    try{client.inspect(input("http://127.0.0.1:1","delete"));fail();}catch(Exception expected){assertEquals("Portal action invalid",expected.getMessage());}
  }
}
