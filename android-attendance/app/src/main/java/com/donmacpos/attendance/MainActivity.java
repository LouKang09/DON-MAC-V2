package com.donmacpos.attendance;
import android.app.Activity;
import android.app.AlertDialog;
import android.os.Build;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
public class MainActivity extends Activity {
 private WebView web;
 private ValueCallback<Uri[]> filePicker;
 private static final int FILE_PICKER=31;
 private static final String HOME="https://donmacpos.com/";
 private static final String EXIT=HOME+"__android_exit__";
 private AlertDialog exitDialog;
 private void immersive(){
  if(Build.VERSION.SDK_INT>=30){
   WindowInsetsController controller=getWindow().getInsetsController();
   if(controller!=null){controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);controller.hide(WindowInsets.Type.systemBars());}
  }else{
   getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }
 }
 private void confirmExit(){
  if(isFinishing()||(exitDialog!=null&&exitDialog.isShowing()))return;
  exitDialog=new AlertDialog.Builder(this).setTitle("Exit Don Mac POS?")
   .setMessage("The app will close. This does not sign you out or clock you out. Complete or clear any unsaved order before exiting.")
   .setNegativeButton("Cancel",(dialog,which)->dialog.dismiss())
   .setPositiveButton("Exit App",(dialog,which)->finishAndRemoveTask()).create();
  exitDialog.setOnDismissListener(dialog->{exitDialog=null;if(!isFinishing())immersive();});
  exitDialog.show();
 }
 private boolean handleNavigation(Uri uri,boolean mainFrame,boolean gesture){
  if(EXIT.equals(uri.toString())){if(mainFrame&&gesture)confirmExit();return true;}
  return !allowed(uri);
 }
 private boolean allowed(Uri u){String path=u.getPath();if(path==null)path="/";return "https".equalsIgnoreCase(u.getScheme())&&"donmacpos.com".equalsIgnoreCase(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&!path.startsWith("/admin-control")&&!path.startsWith("/supply-chain")&&!path.startsWith("/platform-admin")&&!path.startsWith("/supply-office");}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
  if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
  if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->{});
  LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.WHITE);
  if(Build.VERSION.SDK_INT>=30){
   layout.setOnApplyWindowInsetsListener((v,insets)->{
    android.graphics.Insets cutout=insets.getInsets(WindowInsets.Type.displayCutout());
    android.graphics.Insets ime=insets.getInsets(WindowInsets.Type.ime());
    v.setPadding(cutout.left,cutout.top,cutout.right,Math.max(cutout.bottom,ime.bottom));
    return WindowInsets.CONSUMED;
   });
  }
  web=new WebView(this);layout.addView(web,new LinearLayout.LayoutParams(-1,-1));setContentView(layout);
  WebSettings settings=web.getSettings();settings.setUserAgentString(settings.getUserAgentString()+" DonMacCashierApp/1 DonMacNativeExit/1");settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  WebView.setWebContentsDebuggingEnabled(false);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){return handleNavigation(req.getUrl(),req.isForMainFrame(),req.hasGesture());}
   @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return handleNavigation(Uri.parse(url),true,true);}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
    if(filePicker!=null)filePicker.onReceiveValue(null);
    filePicker=callback;
    try{startActivityForResult(params.createIntent(),FILE_PICKER);return true;}
    catch(android.content.ActivityNotFoundException ex){filePicker.onReceiveValue(null);filePicker=null;return true;}
   }
  });
  web.setDownloadListener((url,agent,disposition,mime,length)->{
   Uri u=Uri.parse(url);
   if(!allowed(u)){android.widget.Toast.makeText(this,"This download is not supported in the Android app.",android.widget.Toast.LENGTH_SHORT).show();return;}
   try{
    android.app.DownloadManager.Request request=new android.app.DownloadManager.Request(u);
    request.addRequestHeader("User-Agent",agent);
    String cookies=CookieManager.getInstance().getCookie(url);
    if(cookies!=null)request.addRequestHeader("Cookie",cookies);
    request.setMimeType(mime);
    request.setTitle(URLUtil.guessFileName(url,disposition,mime));
    request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
    ((android.app.DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
   }catch(Exception ex){android.widget.Toast.makeText(this,"Download could not start.",android.widget.Toast.LENGTH_SHORT).show();}
  });
  immersive();
  web.loadUrl(HOME);
 }
 @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
  super.onActivityResult(requestCode,resultCode,data);
  if(requestCode==FILE_PICKER&&filePicker!=null){filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));filePicker=null;}
 }
 @Override protected void onResume(){super.onResume();immersive();}
 @Override public void onWindowFocusChanged(boolean hasFocus){super.onWindowFocusChanged(hasFocus);if(hasFocus)immersive();}
 // Do not let accidental system Back presses navigate away or close the POS.
 @Override public void onBackPressed(){immersive();}
}
