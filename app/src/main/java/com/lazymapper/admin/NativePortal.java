package com.lazymapper.admin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Direct requests for the portal and existing device explicitly supplied by the user.
 * No database/admin key, generated device identity, credential discovery or proxy.
 */
public final class NativePortal {
  private static final class Session {
    final String endpoint, mac, token; final long created=System.currentTimeMillis();
    Session(String e,String m,String t){endpoint=e;mac=m;token=t;}
  }
  private final Map<String,Session> sessions=new ConcurrentHashMap<>();
  private static String enc(String value) throws Exception {return URLEncoder.encode(value,"UTF-8");}
  private JSONObject request(Session session,String action,Map<String,String> extra) throws Exception {
    StringBuilder query=new StringBuilder("action="+enc(action)+"&JsHttpRequest=1-xml");
    for(Map.Entry<String,String> x:extra.entrySet())query.append('&').append(enc(x.getKey())).append('=').append(enc(x.getValue()));
    HttpURLConnection conn=(HttpURLConnection)new URI(session.endpoint+"?"+query).toURL().openConnection();
    try {
      conn.setConnectTimeout(10000);conn.setReadTimeout(15000);conn.setInstanceFollowRedirects(false);
      conn.setRequestProperty("Accept","application/json");
      conn.setRequestProperty("User-Agent","LazyMapper-Pro/1.3");
      conn.setRequestProperty("Cookie","mac="+enc(session.mac)+"; stb_lang=en; timezone=Europe%2FBerlin");
      if(!session.token.isEmpty())conn.setRequestProperty("Authorization","Bearer "+session.token);
      int code=conn.getResponseCode();
      if(code==401||code==403)throw new SecurityException("AUTH REQUIRED — portali refuzoi sesionin");
      if(code==429)throw new SecurityException("RATE LIMITED — ndalo dhe provo më vonë");
      if(code<200||code>=300)throw new Exception("Portal HTTP "+code);
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();
      try(java.io.InputStream input=conn.getInputStream()) {
        byte[] buffer=new byte[8192];int count;
        while((count=input.read(buffer))!=-1){if(bytes.size()+count>5*1024*1024)throw new Exception("Portal response exceeds 5 MB");bytes.write(buffer,0,count);}
      }
      try{return new JSONObject(bytes.toString("UTF-8"));}catch(Exception e){throw new Exception("Portali nuk ktheu JSON");}
    } finally {conn.disconnect();}
  }
  private Object payload(JSONObject value){Object js=value.opt("js");return js!=null&&js!=JSONObject.NULL?js:value.opt("data")!=null?value.opt("data"):value;}
  private JSONArray array(Object value){if(value instanceof JSONArray)return (JSONArray)value;if(value instanceof JSONObject){JSONArray a=((JSONObject)value).optJSONArray("data");if(a!=null)return a;}return new JSONArray();}
  private synchronized Session session(String portal,String mac) throws Exception {
    URI uri=new URI(portal.trim());
    if(!("http".equalsIgnoreCase(uri.getScheme())||"https".equalsIgnoreCase(uri.getScheme()))||uri.getHost()==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null)throw new Exception("Portal URL invalid");
    if(!mac.matches("(?i)([0-9a-f]{2}:){5}[0-9a-f]{2}"))throw new Exception("Device MAC invalid");
    String key=portal+"|"+mac;Session cached=sessions.get(key);
    if(cached!=null&&System.currentTimeMillis()-cached.created<10*60*1000)return cached;
    String root=portal.replaceAll("/+$","");String[] endpoints;
    if(root.matches("(?i).*/(server/load\\.php|portal\\.php)$"))endpoints=new String[]{root};
    else {root=root.replaceAll("(?i)/c$","");endpoints=new String[]{root+"/server/load.php",root+"/portal.php"};}
    Exception last=null;
    for(String endpoint:endpoints){
      try{
        Map<String,String> hello=new LinkedHashMap<>();hello.put("type","stb");hello.put("token","");
        Object p=payload(request(new Session(endpoint,mac,""),"handshake",hello));
        String token=p instanceof JSONObject?((JSONObject)p).optString("token",((JSONObject)p).optString("access_token")):"";
        if(token.isEmpty())throw new SecurityException("AUTH REQUIRED — handshake pa token");
        Session created=new Session(endpoint,mac,token);sessions.put(key,created);return created;
      }catch(SecurityException e){throw e;}catch(Exception e){last=e;if(!String.valueOf(e.getMessage()).contains("404"))throw e;}
    }
    throw last==null?new Exception("Portal unavailable"):last;
  }
  public JSONObject inspect(JSONObject input) throws Exception {
    String action=input.optString("action"), portal=input.optString("portal"),mac=input.optString("mac");
    if(!java.util.Arrays.asList("genres","channels","create_link","vod_genres","vod_items","series_genres","series_items","media_create_link","stbProfile").contains(action))throw new Exception("Portal action invalid");
    Session session=session(portal,mac);
    try {
      String type=action.startsWith("vod_")?"vod":action.startsWith("series_")?"series":"itv";
      Map<String,String> params=new LinkedHashMap<>();params.put("type",type);
      String providerAction;
      if(action.equals("stbProfile")){providerAction="get_profile";params.put("type","stb");}
      else if(action.equals("genres"))providerAction="get_genres";
      else if(action.endsWith("_genres"))providerAction=type.equals("vod")?"get_categories":"get_genres";
      else if(action.equals("create_link")||action.equals("media_create_link")){providerAction="create_link";params.put("cmd",input.optString("cmd"));if(action.equals("media_create_link"))params.put("type",input.optString("mediaType","vod"));}
      else {providerAction="get_ordered_list";params.put("genre",input.optString("genre"));params.put("category",input.optString("genre"));params.put("p",String.valueOf(Math.max(1,input.optInt("page",1))));params.put("fav","0");}
      Object p=payload(request(session,providerAction,params));JSONObject out=new JSONObject().put("ok",true);
      if(action.equals("stbProfile")){JSONObject profile=p instanceof JSONObject?(JSONObject)p:new JSONObject();return out.put("connected",true).put("profile",new JSONObject().put("model",profile.optString("model",profile.optString("stb_type"))).put("status",profile.optString("status")));}
      if(providerAction.equals("create_link")){JSONObject item=p instanceof JSONObject?(JSONObject)p:new JSONObject();String cmd=item.optString("cmd",item.optString("url"));String stream=cmd.replaceFirst("(?i)^ffmpeg\\s+","");if(!stream.matches("(?i)^https?://.*"))throw new Exception("Portali nuk dha URL të luajtshme");return out.put("stream",stream);}
      JSONArray values=array(p);
      if(action.equals("genres")||action.endsWith("_genres")){
        JSONArray genres=new JSONArray();for(int i=0;i<values.length();i++){JSONObject g=values.optJSONObject(i);if(g!=null)genres.put(new JSONObject().put("id",g.optString("id",g.optString("genre_id",g.optString("category_id")))).put("title",g.optString("title",g.optString("name",g.optString("category_name")))));}
        return out.put("genres",genres);
      }
      int max=0;if(p instanceof JSONObject){JSONObject obj=(JSONObject)p;max=obj.optInt("max_page",0);int per=obj.optInt("max_page_items",obj.optInt("items_per_page",0)),total=obj.optInt("total_items",obj.optInt("total",0));if(max==0&&per>0)max=(total+per-1)/per;}
      return out.put("channels",values).put("max_page",max);
    }catch(SecurityException e){sessions.remove(portal+"|"+mac);throw e;}
  }
}
