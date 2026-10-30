package com.lazymapper.admin;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.RecordedRequest;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.atomic.AtomicInteger;

public class NativePortalTest {
  private JSONObject input(String base,String action)throws Exception{return new JSONObject().put("portal",base+"c/").put("mac","00:11:22:33:44:55").put("action",action).put("genre","1");}
  @Test public void connectsWithoutAdminKeyAndReusesIssuedSession()throws Exception {
    AtomicInteger handshakes=new AtomicInteger();MockWebServer server=new MockWebServer();
    server.setDispatcher(new Dispatcher(){@Override public MockResponse dispatch(RecordedRequest request){
      String path=request.getPath();
      if(path.contains("action=handshake")){handshakes.incrementAndGet();return new MockResponse().setBody("{\"js\":{\"token\":\"issued-fixture-token\"}}");}
      if(!"Bearer issued-fixture-token".equals(request.getHeader("Authorization")))return new MockResponse().setResponseCode(401);
      return new MockResponse().setBody(path.contains("action=get_genres")?"{\"js\":[{\"id\":\"1\",\"title\":\"Fixture\"}]}":"{\"js\":{\"data\":[{\"id\":\"2\",\"name\":\"Channel\"}],\"total_items\":12,\"max_page_items\":5}}");
    }});server.start();
    try {String base=server.url("/").toString();NativePortal client=new NativePortal();
      JSONObject genres=client.inspect(input(base,"genres"));assertTrue(genres.getBoolean("ok"));assertEquals("Fixture",genres.getJSONArray("genres").getJSONObject(0).getString("title"));
      JSONObject channels=client.inspect(input(base,"channels"));assertEquals(3,channels.getInt("max_page"));assertEquals(1,handshakes.get());assertFalse(genres.toString().contains("issued-fixture-token"));
    }finally{server.shutdown();}
  }
  @Test public void stopsOnAuthorizationAndRateLimitWithoutRetry()throws Exception {
    for(int code:new int[]{401,429}){MockWebServer server=new MockWebServer();server.enqueue(new MockResponse().setResponseCode(code));server.start();
      try {new NativePortal().inspect(input(server.url("/").toString(),"genres"));fail("Must fail on HTTP "+code);}
      catch(SecurityException expected){assertEquals(1,server.getRequestCount());}finally{server.shutdown();}
    }
  }
  @Test public void rejectsInvalidDeviceAndActions()throws Exception {
    NativePortal client=new NativePortal();
    try{client.inspect(input("http://127.0.0.1:1/","genres").put("mac","invalid"));fail();}catch(Exception expected){assertEquals("Device MAC invalid",expected.getMessage());}
    try{client.inspect(input("http://127.0.0.1:1/","delete"));fail();}catch(Exception expected){assertEquals("Portal action invalid",expected.getMessage());}
  }
}
