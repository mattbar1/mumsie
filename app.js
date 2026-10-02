/* ================= connection ================= */
var cfg = window.MUMSIE_CONFIG || {};
if(!cfg.url || !cfg.anonKey){
  document.getElementById("view").innerHTML =
    '<div class="card"><h2>Setup needed</h2><div class="muted">This deploy is missing its Supabase connection '+
    '(config.js). If you\'re the admin, check the Netlify environment variables.</div></div>';
  document.getElementById("nav").style.display = "none";
  throw new Error("Missing MUMSIE_CONFIG");
}
var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

/* ================= identity (token-based) ================= */
var TKEY = "mumsie_token";
var token = "";
(function initToken(){
  var fromUrl = new URLSearchParams(window.location.search).get("k");
  if(fromUrl){
    token = fromUrl;
    try{localStorage.setItem(TKEY, token);}catch(e){}
    // Keep ?k= in the address bar on purpose: iOS "Add to Home Screen" saves
    // whatever URL is showing at that moment, and a Home Screen icon has its
    // own separate storage from Safari — so if we ever stripped this, the
    // icon would permanently launch with no token and nothing to fall back
    // to. Every future tap of the icon re-sends the token with it.
  } else {
    try{token = localStorage.getItem(TKEY) || "";}catch(e){token = "";}
  }
})();

var authState = token ? "loading" : "no_token"; // no_token | loading | invalid | ok
var me = {name:"", role:"member"};

/* ================= data ================= */
var state = {restaurants:[], visits:[], people:[]};
function clone(o){return JSON.parse(JSON.stringify(o));}

/* ================= helpers ================= */
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function rest(id){return state.restaurants.find(function(r){return r.id===id;});}
function rname(id){var r=rest(id);return r?r.name:"(removed place)";}
function remoji(id){var r=rest(id);return r?r.emoji:"🍽️";}
function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
function startOfDay(ts){var d=new Date(ts);return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();}
function dayLabel(ts){
  var diff=Math.round((startOfDay(Date.now())-startOfDay(ts))/86400000);
  if(diff===0)return "Today"; if(diff===1)return "Yesterday";
  return new Date(ts).toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"});
}
function defaultMeal(){var h=new Date().getHours();return h<11?"Breakfast":(h<16?"Lunch":"Dinner");}
function sortedVisits(){return state.visits.slice().sort(function(a,b){return b.ts-a.ts;});}
function lastVisitTo(id){return sortedVisits().find(function(v){return v.restId===id;});}
function daysSince(id){var v=lastVisitTo(id);return v?(Date.now()-v.ts)/86400000:Infinity;}
function agoText(id){
  var v=lastVisitTo(id); if(!v)return "Not logged yet";
  var d=startOfDay(Date.now())-startOfDay(v.ts), n=Math.round(d/86400000);
  return n===0?"Went today":(n===1?"Went yesterday":"Went "+n+" days ago");
}
function bg(r){var h=r?r.hue:30;return "background:linear-gradient(145deg,hsl("+h+",85%,94%),hsl("+h+",75%,84%))";}
function toLocalInput(d){
  function p(n){return (n<10?"0":"")+n;}
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
}
function toast(msg){var t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(function(){t.classList.remove("show");},2200);}
function visitTags(v){
  return '<span class="tag">'+esc(v.meal)+'</span><span class="tag">'+(v.type==="Takeout"?"🥡 Takeout":"🪑 Ate there")+'</span>'+
    v.who.map(function(w){return '<span class="tag">👤 '+esc(w)+'</span>';}).join("");
}
function isAdmin(){return me.role==="admin";}

/* ================= server sync ================= */
var syncing = false;
function sync(showSpinnerIfFirst){
  if(!token){authState="no_token";render();return;}
  if(syncing)return;
  syncing = true;
  sb.rpc("app_sync", {p_token: token}).then(function(res){
    syncing = false;
    if(res.error){
      if(authState==="loading"){authState="invalid";render();}
      else toast("Couldn't reach the server — showing last data");
      return;
    }
    var data = res.data;
    if(!data || !data.ok){authState="invalid";render();return;}
    authState = "ok";
    me = data.me;
    state.people = data.people.map(function(p){return p.name;});
    state.restaurants = data.restaurants;
    state.visits = data.visits;
    render();
  }).catch(function(){
    syncing = false;
    if(authState==="loading"){authState="invalid";render();}
    else toast("Couldn't reach the server — showing last data");
  });
}

/* ================= shell ================= */
var tab="home";
var tabs=[["home","🏠","Home"],["pick","🎲","Pick"],["log","➕","Log"],["history","📖","History"],["places","🍴","Places"]];
function go(t){tab=t;render();window.scrollTo(0,0);}
function meBtnTap(){toast("You're signed in as "+me.name+(isAdmin()?" (admin)":""));}
function render(){
  var meBtn=document.getElementById("meBtn");
  var nav=document.getElementById("nav");
  if(authState!=="ok"){
    meBtn.style.display="none";
    nav.style.display="none";
    document.getElementById("view").innerHTML=viewAuthScreen();
    return;
  }
  meBtn.style.display="block"; meBtn.textContent="👤 "+me.name;
  nav.style.display="flex";
  nav.innerHTML=tabs.map(function(t){return '<button class="'+(tab===t[0]?"on":"")+'" onclick="go(\''+t[0]+'\')"><span>'+t[1]+'</span>'+t[2]+'</button>';}).join("");
  var v=document.getElementById("view");
  if(tab==="home")v.innerHTML=viewHome();
  else if(tab==="pick")v.innerHTML=viewPick();
  else if(tab==="log")v.innerHTML=viewLog();
  else if(tab==="history")v.innerHTML=viewHistory();
  else v.innerHTML=viewPlaces();
}

/* ================= auth screens ================= */
function viewAuthScreen(){
  if(authState==="loading"){
    return '<div class="card"><h2>Loading…</h2><div class="muted">Getting Mumsie\'s meals.</div></div>';
  }
  if(authState==="invalid"){
    return '<div class="card"><h2>Link not recognized</h2><div class="muted">This link doesn\'t match anyone. '+
      'Ask Lisa to resend your personal link, then open it again.</div></div>';
  }
  return '<div class="card"><h2>You need your personal link</h2><div class="muted">This app only works from the '+
    'personal link Lisa sent you. Ask her for it, then open it on this phone (and again from the Home Screen icon, '+
    'if you add one — they\'re stored separately).</div></div>';
}

/* ================= home ================= */
function todayVisit(meal){
  var s=startOfDay(Date.now());
  return sortedVisits().find(function(v){return v.meal===meal&&startOfDay(v.ts)===s;});
}
function viewHome(){
  var vs=sortedVisits(), h="";
  var meals=["Lunch","Dinner"]; if(todayVisit("Breakfast"))meals.unshift("Breakfast");
  h+='<div class="sec">Today</div><div class="status">'+meals.map(function(m){
    var v=todayVisit(m);
    return v?'<button class="s done" onclick="go(\'history\')"><b>✅ '+m+'</b><br>'+esc(rname(v.restId))+'<br><span class="muted">'+esc(v.who.join(", "))+' · '+fmtTime(v.ts)+'</span></button>'
            :'<button class="s" onclick="quickLog(\''+m+'\')"><b>⬜ '+m+'</b><br><span class="muted">Not logged yet.<br>Tap to log</span></button>';
  }).join("")+'</div>';
  if(vs.length){
    var l=vs[0], r=rest(l.restId);
    h+='<div class="sec">Last meal</div><div class="card" style="'+bg(r)+'"><div style="display:flex;gap:14px;align-items:center"><div style="font-size:54px">'+remoji(l.restId)+'</div>'+
      '<div><h2 style="margin:0">'+esc(rname(l.restId))+'</h2><div class="muted">'+dayLabel(l.ts)+' at '+fmtTime(l.ts)+'</div></div></div>'+visitTags(l)+
      (l.ate?'<div style="margin-top:10px"><b>Had:</b> '+esc(l.ate)+'</div>':'')+'</div>';
  } else {
    h+='<div class="card"><h2>No meals logged yet</h2><div class="muted">After Mumsie eats, tap Log. It takes two taps.</div></div>';
  }
  h+='<button onclick="go(\'pick\')">🎲 Help us pick a place</button>';
  h+='<button class="secondary" onclick="go(\'log\')">➕ Log a meal</button>';
  if(vs.length>1){
    h+='<div class="sec">Recent</div>';
    vs.slice(1,5).forEach(function(x){
      h+='<div class="card" style="padding:14px"><b>'+remoji(x.restId)+' '+esc(rname(x.restId))+'</b><div class="muted">'+dayLabel(x.ts)+' · '+fmtTime(x.ts)+'</div>'+visitTags(x)+'</div>';
    });
  }
  return h;
}
function quickLog(meal){logDraft=newDraft();logDraft.meal=meal;go("log");}

/* ================= picker ================= */
var pick={meal:defaultMeal(),avoid:3,rejected:[],current:null,dish:"",spinning:false,none:false,timer:null};
function candidates(){
  return state.restaurants.filter(function(r){return daysSince(r.id)>=pick.avoid&&pick.rejected.indexOf(r.id)===-1;});
}
function doPick(){
  var list=candidates();
  if(!list.length){pick.current=null;pick.none=true;render();return;}
  pick.none=false;pick.dish="";
  var final=list[Math.floor(Math.random()*list.length)];
  pick.spinning=true;render();
  var names=state.restaurants, i=0, started=Date.now();
  clearInterval(pick.timer);
  pick.timer=setInterval(function(){
    var el=document.getElementById("spinName"),pl=document.getElementById("spinPlate");
    var r=names[i++%names.length];
    if(el)el.textContent=r.name; if(pl)pl.textContent=r.emoji;
    if(Date.now()-started>1300){clearInterval(pick.timer);pick.spinning=false;pick.current=final;render();}
  },90);
}
function pickAnother(){if(pick.current)pick.rejected.push(pick.current.id);doPick();}
function resetPick(){pick.rejected=[];pick.current=null;pick.none=false;render();}
function setPickMeal(m){pick.meal=m;render();}
function setAvoid(n){pick.avoid=parseInt(n,10);pick.rejected=[];pick.current=null;pick.none=false;render();}
function suggestDish(){
  var r=pick.current; if(!r||!r.menu.length)return;
  var pool=r.menu.filter(function(m){return m!==pick.dish;});
  pick.dish=pool[Math.floor(Math.random()*pool.length)]||r.menu[0];render();
}
function goHere(){
  var r=pick.current; logDraft=newDraft(); logDraft.restId=r.id; logDraft.meal=pick.meal;
  if(pick.dish)logDraft.items=[pick.dish];
  go("log");
}
function viewPick(){
  var h='<div class="card"><label style="margin-top:0">Which meal?</label><div class="seg">'+
    ["Breakfast","Lunch","Dinner"].map(function(m){return '<button class="'+(pick.meal===m?"on":"")+'" onclick="setPickMeal(\''+m+'\')">'+m+'</button>';}).join("")+'</div>'+
    '<label>Skip places she went to in the last…</label><select onchange="setAvoid(this.value)">'+
    [[0,"Don't skip any"],[1,"1 day"],[3,"3 days"],[7,"7 days"]].map(function(o){return '<option value="'+o[0]+'"'+(pick.avoid===o[0]?" selected":"")+'>'+o[1]+'</option>';}).join("")+'</select></div>';
  if(pick.spinning){
    h+='<div class="result spin" style="background:#fff3e3"><div class="plate" id="spinPlate">🍽️</div><h2 id="spinName">Picking…</h2></div>';
  } else if(pick.current){
    var r=pick.current, last=lastVisitTo(r.id);
    h+='<div class="result" style="'+bg(r)+'"><div class="muted">How about…</div><div class="plate">'+esc(r.emoji)+'</div><h2>'+esc(r.name)+'</h2>'+
      '<div>'+esc(r.cuisine)+'</div><div class="muted" style="margin-top:6px">'+agoText(r.id)+(last&&last.ate?' · had '+esc(last.ate):'')+'</div></div>';
    if(pick.dish)h+='<div class="dish">🍴 Try the: '+esc(pick.dish)+'</div>';
    h+='<button class="good" onclick="goHere()">✅ Yes, we\'re going here</button>';
    h+='<button class="secondary" onclick="pickAnother()">🔄 Pick another place</button>';
    if(r.menu.length)h+='<button class="secondary" onclick="suggestDish()">🍴 Suggest a dish</button>';
    h+='<div class="card"><b>Menu ideas</b>'+(r.menu.length?'<ul class="menu">'+r.menu.map(function(m){return '<li>'+esc(m)+'</li>';}).join("")+'</ul>':'<div class="muted">No dishes added yet.</div>')+
      (r.url?'<div style="margin-top:10px"><a href="'+esc(r.url)+'" target="_blank" rel="noopener">See full menu ↗</a></div>':'')+
      (r.phone?'<div style="margin-top:6px"><a href="tel:'+esc(r.phone.replace(/[^0-9+]/g,""))+'">📞 '+esc(r.phone)+'</a></div>':'')+
      (r.hours?'<div class="muted" style="margin-top:6px">🕒 '+esc(r.hours)+'</div>':'')+'</div>';
  } else if(pick.none){
    h+='<div class="card"><h2>Out of choices</h2><div class="muted">Everything was skipped or recently visited. Start over, or lower the "skip" setting.</div></div><button onclick="resetPick()">Start over</button>';
  } else {
    h+='<button onclick="doPick()" style="min-height:90px;font-size:26px">🎲 Pick a restaurant for me</button>';
  }
  return h;
}

/* ================= log ================= */
var logDraft=null;
var savingVisit=false;
var editingVisitId=null;
function newDraft(){return {restId:"",meal:defaultMeal(),type:"Ate there",who:[me.name],items:[],text:"",custom:"",showTime:false};}
function draftTs(d){return d.custom?new Date(d.custom).getTime():Date.now();}
function startEditVisit(id){
  var v=state.visits.find(function(x){return x.id===id;});
  if(!v)return;
  logDraft={restId:v.restId, meal:v.meal, type:v.type, who:v.who.slice(), items:[], text:v.ate||"", custom:toLocalInput(new Date(v.ts)), showTime:true};
  editingVisitId=id;
  go("log");
}
function cancelEditVisit(){logDraft=null;editingVisitId=null;go("history");}
function viewLog(){
  if(!logDraft)logDraft=newDraft();
  var d=logDraft, r=rest(d.restId), h="";
  if(editingVisitId)h+='<div class="banner">✏️ Editing a past entry.</div><button class="small secondary" onclick="cancelEditVisit()">Cancel edit</button>';
  // duplicate warning
  var dup=sortedVisits().find(function(v){return v.id!==editingVisitId&&v.meal===d.meal&&startOfDay(v.ts)===startOfDay(draftTs(d));});
  if(dup)h+='<div class="banner">⚠️ '+esc(d.meal)+' was already logged: '+esc(rname(dup.restId))+' by '+esc(dup.who.join(", "))+' at '+fmtTime(dup.ts)+'.</div>';
  h+='<div class="sec" style="margin-top:12px">1 · Where did she eat?</div><div class="grid">'+state.restaurants.map(function(x){
    return '<button class="tile'+(d.restId===x.id?" on":"")+'" style="'+bg(x)+'" onclick="setRest(\''+x.id+'\')"><span class="e">'+esc(x.emoji)+'</span>'+esc(x.name)+'<small>'+agoText(x.id)+'</small></button>';
  }).join("")+'</div>';
  h+='<div class="sec">2 · Which meal?</div><div class="seg">'+["Breakfast","Lunch","Dinner"].map(function(m){return '<button class="'+(d.meal===m?"on":"")+'" onclick="logSet(\'meal\',\''+m+'\')">'+m+'</button>';}).join("")+'</div>';
  h+='<div class="sec">3 · Dine-in or takeout?</div><div class="seg">'+[["Ate there","🪑 Ate there"],["Takeout","🥡 Takeout"]].map(function(m){return '<button class="'+(d.type===m[0]?"on":"")+'" onclick="logSet(\'type\',\''+m[0]+'\')">'+m[1]+'</button>';}).join("")+'</div>';
  h+='<div class="sec">4 · Who took her? (pick one or more)</div><div class="chips">'+state.people.map(function(p,i){return '<button class="chip'+(d.who.indexOf(p)>-1?" on":"")+'" onclick="toggleWho('+i+')">'+esc(p)+'</button>';}).join("")+'</div>';
  if(r&&r.menu.length){
    h+='<div class="sec">What did she have? (optional)</div><div class="chips">'+r.menu.map(function(m,i){return '<button class="chip item'+(d.items.indexOf(m)>-1?" on":"")+'" onclick="toggleItem('+i+')">'+esc(m)+'</button>';}).join("")+'</div>';
  } else if(r){
    h+='<div class="sec">What did she have? (optional)</div>';
  }
  if(r)h+='<input id="f_text" placeholder="Something else? Type it here" value="'+esc(d.text)+'" oninput="logDraft.text=this.value" style="margin-top:12px">';
  h+='<div style="margin-top:14px">'+(d.showTime
      ?'<label style="margin-top:0">When was this?</label><input type="datetime-local" id="f_time" value="'+esc(d.custom||toLocalInput(new Date()))+'" onchange="logDraft.custom=this.value;render()">'
      :'<button class="small secondary" onclick="logDraft.showTime=true;render()">🕒 Not just now? Change the time</button>')+'</div>';
  h+='<button class="good" style="min-height:76px;font-size:26px;margin-top:20px" onclick="saveVisit()"'+(savingVisit?' disabled':'')+'>'+(savingVisit?'Saving…':(editingVisitId?'✅ Update meal':'✅ Save meal'))+'</button>';
  return h;
}
function setRest(id){logDraft.restId=id;logDraft.items=[];render();}
function logSet(k,v){logDraft[k]=v;render();}
function toggleWho(i){
  var p=state.people[i], at=logDraft.who.indexOf(p);
  if(at>-1)logDraft.who.splice(at,1); else logDraft.who.push(p);
  render();
}
function toggleItem(i){
  var m=rest(logDraft.restId).menu[i], at=logDraft.items.indexOf(m);
  if(at>-1)logDraft.items.splice(at,1); else logDraft.items.push(m);
  render();
}
function saveVisit(){
  var d=logDraft;
  if(!d.restId){toast("Tap a restaurant first");return;}
  if(!d.who.length){toast("Choose who took her");return;}
  if(savingVisit)return;
  var parts=d.items.slice(); if(d.text.trim())parts.push(d.text.trim());
  savingVisit=true;render();
  var wasEditing=editingVisitId;
  var params={
    p_token:token, p_rest_id:d.restId, p_meal:d.meal, p_type:d.type,
    p_who:d.who, p_ate:parts.join(", "), p_ts:draftTs(d)
  };
  var call = wasEditing
    ? sb.rpc("update_visit", Object.assign({p_visit_id:wasEditing}, params))
    : sb.rpc("log_visit", params);
  call.then(function(res){
    savingVisit=false;
    if(res.error || !res.data || !res.data.ok){
      toast(res.data && res.data.error==="forbidden" ? "You can only edit your own entries" : "Couldn't save — check your connection and try again");
      render();
      return;
    }
    logDraft=null;editingVisitId=null;pick.rejected=[];pick.current=null;pick.dish="";
    toast(wasEditing?"Updated ✅":"Saved! ✅");go(wasEditing?"history":"home");
    sync();
  }).catch(function(){savingVisit=false;toast("Couldn't save — check your connection and try again");render();});
}

/* ================= history ================= */
function viewHistory(){
  var vs=sortedVisits();
  if(!vs.length)return '<div class="card"><h2>Nothing logged yet</h2><div class="muted">Saved meals show up here.</div></div>';
  var h="",last="";
  vs.forEach(function(v){
    var dl=dayLabel(v.ts);
    if(dl!==last){h+='<div class="sec">'+dl+'</div>';last=dl;}
    h+='<div class="card" style="'+bg(rest(v.restId))+';padding:14px"><div style="display:flex;gap:12px;align-items:center"><div style="font-size:40px">'+remoji(v.restId)+'</div>'+
      '<div><b>'+esc(rname(v.restId))+'</b><div class="muted">'+fmtTime(v.ts)+'</div></div></div>'+visitTags(v)+
      (v.ate?'<div style="margin-top:8px"><b>Had:</b> '+esc(v.ate)+'</div>':'')+
      '<button class="small secondary" onclick="startEditVisit(\''+v.id+'\')">✏️ Edit</button>'+
      '<button class="small danger" onclick="delVisit(\''+v.id+'\')">Delete</button></div>';
  });
  return h;
}
function delVisit(id){
  if(!confirm("Delete this entry?"))return;
  sb.rpc("delete_visit",{p_token:token, p_visit_id:id}).then(function(res){
    if(res.error || !res.data || !res.data.ok){
      toast(res.data && res.data.error==="forbidden" ? "You can only delete your own entries" : "Couldn't delete that entry");
      return;
    }
    sync();
  }).catch(function(){toast("Couldn't delete that entry");});
}

/* ================= places ================= */
var editing=null; // null | "new" | id
var savingPlace=false;
function viewPlaces(){
  var h="";
  if(editing)return viewEditPlace();
  if(isAdmin())h+='<button onclick="editing=\'new\';render()">➕ Add a restaurant</button>';
  else h+='<div class="banner">Only Lisa can add or change restaurants.</div>';
  h+='<div class="sec">'+state.restaurants.length+' restaurants</div>';
  state.restaurants.forEach(function(r){
    h+='<div class="card" style="'+bg(r)+'"><div style="display:flex;gap:14px;align-items:center"><div style="font-size:50px">'+esc(r.emoji)+'</div>'+
      '<div><h2 style="margin:0">'+esc(r.name)+'</h2><div class="muted">'+esc(r.cuisine)+'</div></div></div>'+
      '<div class="muted" style="margin-top:8px">'+agoText(r.id)+'</div>'+
      (r.address?'<div style="margin-top:6px">📍 '+esc(r.address)+'</div>':'')+
      (r.phone?'<div><a href="tel:'+esc(r.phone.replace(/[^0-9+]/g,""))+'">📞 '+esc(r.phone)+'</a></div>':'')+
      (r.hours?'<div class="muted">🕒 '+esc(r.hours)+'</div>':'')+
      (r.menu.length?'<ul class="menu">'+r.menu.map(function(m){return '<li>'+esc(m)+'</li>';}).join("")+'</ul>':'')+
      (r.note?'<div class="muted" style="margin-top:8px"><i>'+esc(r.note)+'</i></div>':'')+
      (r.url?'<div style="margin-top:8px"><a href="'+esc(r.url)+'" target="_blank" rel="noopener">Full menu ↗</a></div>':'')+
      (isAdmin()?'<button class="small secondary" onclick="editing=\''+r.id+'\';render()">✏️ Edit</button><button class="small danger" onclick="delPlace(\''+r.id+'\')">Remove</button>':'')+
      '</div>';
  });
  if(isAdmin()){
    if(adminPeople===null)loadAdminPeople();
    h+=viewFamilyAccess();
  }
  return h;
}

/* ---- family access (admin only) ---- */
var adminPeople=null, adminPeopleBusy=false, addingPerson=false, newPersonRole="member";
function loadAdminPeople(){
  if(adminPeopleBusy)return;
  adminPeopleBusy=true;
  sb.rpc("admin_list_people",{p_token:token}).then(function(res){
    adminPeopleBusy=false;
    if(res.data && res.data.ok)adminPeople=res.data.people;
    render();
  }).catch(function(){adminPeopleBusy=false;});
}
function viewFamilyAccess(){
  var h='<div class="sec">Family access</div>';
  if(addingPerson){
    h+='<div class="card"><label style="margin-top:0">Name</label><input id="p_name" placeholder="Their name">'+
      '<label>Role</label><div class="seg">'+["member","admin"].map(function(r){
        return '<button class="'+(newPersonRole===r?"on":"")+'" onclick="newPersonRole=\''+r+'\';render()">'+(r==="admin"?"Admin":"Member")+'</button>';
      }).join("")+'</div>'+
      '<button class="good" onclick="addPerson()"'+(adminPeopleBusy?' disabled':'')+'>'+(adminPeopleBusy?'Adding…':'Add')+'</button>'+
      '<button class="secondary" onclick="addingPerson=false;render()">Cancel</button></div>';
  } else {
    h+='<button onclick="addingPerson=true;newPersonRole=\'member\';render()">➕ Add a person</button>';
  }
  if(adminPeople===null){
    h+='<div class="muted" style="margin:10px 4px">Loading…</div>';
  } else {
    var adminCount=adminPeople.filter(function(p){return p.role==="admin";}).length;
    adminPeople.forEach(function(p){
      var safeName=esc(p.name).replace(/'/g,"&#39;");
      h+='<div class="card" style="padding:14px"><b>'+esc(p.name)+'</b> <span class="tag">'+(p.role==="admin"?"Admin":"Member")+'</span>'+
        '<div><button class="small secondary" onclick="copyPersonLink(\''+p.token+'\',\''+safeName+'\')">🔗 Copy link</button>'+
        (p.role==="admin"&&adminCount<=1?'':'<button class="small danger" onclick="removePerson(\''+p.id+'\',\''+safeName+'\')">Remove</button>')+
        '</div></div>';
    });
  }
  return h;
}
function copyPersonLink(tok,name){
  var link=location.origin+location.pathname+"?k="+tok;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(link).then(function(){toast("Link copied for "+name);})
      .catch(function(){prompt("Copy this link for "+name+":",link);});
  } else {
    prompt("Copy this link for "+name+":",link);
  }
}
function addPerson(){
  var name=document.getElementById("p_name").value.trim();
  if(!name){toast("Enter a name");return;}
  if(adminPeopleBusy)return;
  adminPeopleBusy=true;render();
  sb.rpc("admin_add_person",{p_token:token,p_name:name,p_role:newPersonRole}).then(function(res){
    adminPeopleBusy=false;
    if(res.error || !res.data || !res.data.ok){toast("Couldn't add — try again");render();return;}
    addingPerson=false;adminPeople=null;
    toast("Added "+res.data.name+" — copy their link to send it");
    loadAdminPeople();
    sync();
  }).catch(function(){adminPeopleBusy=false;toast("Couldn't add — try again");render();});
}
function removePerson(id,name){
  if(!confirm("Remove "+name+"? They'll lose access right away. Their past entries stay in history."))return;
  sb.rpc("admin_remove_person",{p_token:token,p_person_id:id}).then(function(res){
    if(res.error || !res.data || !res.data.ok){
      toast(res.data && res.data.error==="last_admin" ? "Can't remove the only admin" : "Couldn't remove them");
      return;
    }
    adminPeople=null;
    toast("Removed "+name);
    loadAdminPeople();
    sync();
  }).catch(function(){toast("Couldn't remove them");});
}
function viewEditPlace(){
  var r=editing==="new"?{name:"",emoji:"🍽️",hue:30,cuisine:"",address:"",phone:"",hours:"",url:"",menu:[],note:""}:rest(editing);
  return '<div class="card"><h2>'+(editing==="new"?"Add restaurant":"Edit restaurant")+'</h2>'+
    '<label>Name</label><input id="e_name" value="'+esc(r.name)+'">'+
    '<label>Emoji picture (one emoji)</label><input id="e_emoji" value="'+esc(r.emoji)+'">'+
    '<label>Type of food</label><input id="e_cuisine" value="'+esc(r.cuisine)+'">'+
    '<label>Address</label><input id="e_address" value="'+esc(r.address||"")+'">'+
    '<label>Phone</label><input id="e_phone" value="'+esc(r.phone||"")+'">'+
    '<label>Hours</label><input id="e_hours" value="'+esc(r.hours||"")+'">'+
    '<label>Website / menu link</label><input id="e_url" value="'+esc(r.url||"")+'">'+
    '<label>Her favorite dishes (one per line)</label><textarea id="e_menu" style="min-height:160px">'+esc(r.menu.join("\n"))+'</textarea>'+
    '<button class="good" onclick="savePlace()"'+(savingPlace?' disabled':'')+'>'+(savingPlace?'Saving…':'Save')+'</button>'+
    '<button class="secondary" onclick="editing=null;render()">Cancel</button></div>';
}
function savePlace(){
  function g(i){return document.getElementById(i).value.trim();}
  if(!g("e_name")){toast("Please enter a name");return;}
  if(savingPlace)return;
  var menu=document.getElementById("e_menu").value.split("\n").map(function(s){return s.trim();}).filter(Boolean);
  var fields={p_name:g("e_name"),p_emoji:g("e_emoji")||"🍽️",p_cuisine:g("e_cuisine"),p_address:g("e_address"),
              p_phone:g("e_phone"),p_hours:g("e_hours"),p_url:g("e_url"),p_menu:menu};
  savingPlace=true;render();
  var call = editing==="new"
    ? sb.rpc("add_restaurant", Object.assign({p_token:token}, fields))
    : sb.rpc("update_restaurant", Object.assign({p_token:token, p_id:editing}, fields));
  call.then(function(res){
    savingPlace=false;
    if(res.error || !res.data || !res.data.ok){
      toast("Couldn't save — "+(res.data && res.data.error==="forbidden" ? "admin only" : "try again"));
      render();
      return;
    }
    editing=null;toast("Saved ✅");
    sync();
  }).catch(function(){savingPlace=false;toast("Couldn't save — try again");render();});
}
function delPlace(id){
  if(!confirm("Remove this restaurant? Old entries will show as removed."))return;
  sb.rpc("delete_restaurant",{p_token:token, p_id:id}).then(function(res){
    if(res.error || !res.data || !res.data.ok){toast("Couldn't remove that restaurant");return;}
    sync();
  }).catch(function(){toast("Couldn't remove that restaurant");});
}

/* ================= boot + live refresh ================= */
render();
sync();
setInterval(function(){sync();}, 20000);
document.addEventListener("visibilitychange", function(){ if(!document.hidden) sync(); });
window.addEventListener("pageshow", function(){ sync(); });
