(function () {
  "use strict";

  const PluginApi = window.PluginApi;
  const React = PluginApi.React;
  const { useState, useEffect } = React;
  const GQL = PluginApi.GQL;

  const h = React.createElement;

  // ── Utility: raw GraphQL fetch ────────────────────────────────────────────
  async function gqlQuery(query, variables) {
    const resp = await fetch("/graphql", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const json = await resp.json();
    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json.data;
  }

  const STORAGE_KEY = "stashPlusUnlocked";

  // One-time migration of saved data from the pre-rename "stashAchieve" keys.
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.indexOf("stashAchieve") !== 0) return;
      const nk = "stashPlus" + k.slice("stashAchieve".length);
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
    });
  } catch (e) {}

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Returns { year, month (0-11), day, hour, minute, weekday (0=Sun..6=Sat) } for a
  // given Date/timestamp, as observed in the Europe/Rome timezone.
  function getRomeParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short"
    }).formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const WEEKDAYS = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    let hour = Number(map.hour);
    if (hour === 24) hour = 0; // some locales render midnight as 24
    return {
      year: Number(map.year), month: Number(map.month) - 1, day: Number(map.day),
      hour, minute: Number(map.minute), weekday: WEEKDAYS[map.weekday],
    };
  }

  // Returns { year, month (0-11), day } for "today" in Europe/Rome timezone.
  function getRomeToday() {
    const p = getRomeParts(new Date());
    return { year: p.year, month: p.month, day: p.day };
  }

  function getAge(birthdate) {
    if (!birthdate) return null;
    const bd = new Date(birthdate);
    if (isNaN(bd.getTime())) return null;
    const today = getRomeToday();
    let age = today.year - bd.getFullYear();
    if (today.month < bd.getMonth() || (today.month === bd.getMonth() && today.day < bd.getDate())) age--;
    return age;
  }

  // dateKey for a Date, using its Europe/Rome calendar day (so streaks/distinct-days
  // line up with the same "day" used for the O-history timing achievements).
  function dateKey(d) {
    const p = getRomeParts(d);
    return `${p.year}-${String(p.month+1).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
  }

  function longestStreak(dayKeys) {
    const ms = Array.from(dayKeys).map(k => { const [y,m,d] = k.split("-").map(Number); return new Date(y,m-1,d).getTime(); }).sort((a,b)=>a-b);
    if (!ms.length) return 0;
    let longest = 1, cur = 1;
    for (let i = 1; i < ms.length; i++) {
      if (ms[i] - ms[i-1] === 86400000) cur++;
      else if (ms[i] !== ms[i-1]) cur = 1;
      if (cur > longest) longest = cur;
    }
    return longest;
  }

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function monthLabel(mKey) { const [y,m] = mKey.split("-"); return `${MONTH_NAMES[Number(m)-1]} ${y}`; }

  // ── Tag achievements config ───────────────────────────────────────────────
  const TAG_ACHIEVEMENTS = [
    { id:"tag-creampie",    tagName:"creampie",           icon:"🍳",  name:"Masterchef",           description:"Log an O on 10 scenes tagged Creampie.",           target:10, tier:"medium" },
    { id:"tag-anal",        tagName:"anal",               icon:"⛏️",  name:"Cave Explorer",         description:"Log an O on 10 scenes tagged Anal.",               target:10, tier:"medium" },
    { id:"tag-threesome",   tagName:"threesome",          icon:"🎉",  name:"Crowd Pleaser",         description:"Log an O on 10 scenes tagged Threesome.",          target:10, tier:"medium" },
    { id:"tag-dp",          tagName:"double penetration", icon:"✌️",  name:"Double Trouble",        description:"Log an O on 5 scenes tagged Double Penetration.",   target:5,  tier:"hard"   },
    { id:"tag-public",      tagName:"public",             icon:"🏞️",  name:"Exhibitionist",         description:"Log an O on 10 scenes tagged Public.",             target:10, tier:"medium" },
    { id:"tag-cosplay",     tagName:"cosplay",            icon:"🎭",  name:"Cosplay Connoisseur",   description:"Log an O on 10 scenes tagged Cosplay.",            target:10, tier:"easy"   },
    { id:"tag-massage",     tagName:"massage",            icon:"💆",  name:"Happy Ending",          description:"Log an O on 10 scenes tagged Massage.",            target:10, tier:"medium" },
    { id:"tag-pov",         tagName:"pov",                icon:"🕶️",  name:"First Person Shooter",  description:"Log an O on 15 scenes tagged POV.",                target:15, tier:"medium" },
    { id:"tag-blowjob",     tagName:"blowjob",            icon:"🌬️",  name:"Wind Instrument",       description:"Log an O on 20 scenes tagged Blowjob.",            target:20, tier:"medium" },
    { id:"tag-lesbian",     tagName:"lesbian",            icon:"🌸",  name:"Ladies Night",          description:"Log an O on 15 scenes tagged Lesbian.",            target:15, tier:"medium" },
    { id:"tag-squirt",      tagName:"squirt",             icon:"💦",  name:"Water Park",            description:"Log an O on 10 scenes tagged Squirt.",             target:10, tier:"medium" },
    { id:"tag-gangbang",    tagName:"gangbang",           icon:"🎳",  name:"Strike!",               description:"Log an O on 5 scenes tagged Gangbang.",            target:5,  tier:"hard"   },
    { id:"tag-bdsm",        tagName:"bdsm",               icon:"⛓️",  name:"Fully Committed",       description:"Log an O on 10 scenes tagged BDSM.",               target:10, tier:"hard"   },
    { id:"tag-interracial", tagName:"interracial",        icon:"🌍",  name:"United Colors",         description:"Log an O on 10 scenes tagged Interracial.",        target:10, tier:"medium" },
    { id:"tag-outdoor",     tagName:"outdoor",            icon:"🌲",  name:"Al Fresco",             description:"Log an O on 10 scenes tagged Outdoor.",            target:10, tier:"medium" },
    { id:"tag-stockings",   tagName:"stockings",          icon:"🧦",  name:"Leg Day",               description:"Log an O on 10 scenes tagged Stockings.",          target:10, tier:"easy"   },
    { id:"tag-facial",      tagName:"facial",             icon:"🧖",  name:"Skincare Routine",      description:"Log an O on 10 scenes tagged Facial.",             target:10, tier:"medium" },
    { id:"tag-casting",     tagName:"casting",            icon:"🎬",  name:"Talent Scout",          description:"Log an O on 10 scenes tagged Casting.",            target:10, tier:"easy"   },
    { id:"tag-orgy",        tagName:"orgy",               icon:"🎊",  name:"Life of the Party",     description:"Log an O on 5 scenes tagged Orgy.",                target:5,  tier:"hard"   },
    { id:"tag-cumshot",     tagName:"cumshot",            icon:"🎯",  name:"Sniper",                description:"Log an O on 25 scenes tagged Cumshot.",            target:25, tier:"medium" },
  ];

  // ── Chroma/time achievements config ───────────────────────────────────────
  // Each rule fires once per unique O event where a body-stat condition (hair
  // colour, eye colour, height, weight) coincides with a time condition
  // (hour, weekday, month/day). attrs = { hair:Set, eye:Set, tall, short, heavy, light }
  // rp = { hour, weekday, month, day } (weekday: 0=Sun..6=Sat)
  const CHROMA_RULES = [
    { id:"blue-monday",         flag:"blueMonday",         icon:"🔵", name:"Blue Monday",            tier:"medium", desc:"O with a blue-haired performer on a Monday.",
      test:(a,rp)=> a.hair.has("blue") && rp.weekday===1 },
    { id:"sunset-red",          flag:"sunsetRed",          icon:"🌇", name:"Sunset Red",              tier:"medium", desc:"O with a red-haired performer between 6-8pm.",
      test:(a,rp)=> a.hair.has("red") && rp.hour>=18 && rp.hour<20 },
    { id:"golden-hour",         flag:"goldenHour",         icon:"🌅", name:"Golden Hour",             tier:"medium", desc:"O with a blonde performer between 6-8pm.",
      test:(a,rp)=> a.hair.has("blonde") && rp.hour>=18 && rp.hour<20 },
    { id:"black-friday",        flag:"blackFriday",        icon:"🖤", name:"Black Friday",            tier:"easy",   desc:"O with a black-haired performer on a Friday.",
      test:(a,rp)=> a.hair.has("black") && rp.weekday===5 },
    { id:"silver-fox-oclock",   flag:"silverFoxOclock",    icon:"🌙", name:"Silver Fox O'Clock",      tier:"medium", desc:"O with a grey/silver-haired performer after 10pm.",
      test:(a,rp)=> (a.hair.has("grey")||a.hair.has("gray")||a.hair.has("silver")) && rp.hour>=22 },
    { id:"baby-blues",          flag:"babyBlues",          icon:"👶", name:"Baby Blues",              tier:"medium", desc:"O with a blue-eyed performer between 5-8am.",
      test:(a,rp)=> a.eye.has("blue") && rp.hour>=5 && rp.hour<8 },
    { id:"green-eyed-monster",  flag:"greenEyedMonster",   icon:"👹", name:"Green-Eyed Monster",      tier:"hard",   desc:"O with a green-eyed performer between midnight and 3am.",
      test:(a,rp)=> a.eye.has("green") && rp.hour>=0 && rp.hour<3 },
    { id:"brown-eyed-girl",     flag:"brownEyedGirl",      icon:"🎵", name:"Brown Eyed Girl",         tier:"easy",   desc:"O with a brown-eyed performer on a Sunday morning.",
      test:(a,rp)=> a.eye.has("brown") && rp.weekday===0 && rp.hour>=6 && rp.hour<12 },
    { id:"heavyweight-nightcap",flag:"heavyweightNightcap",icon:"🌃", name:"Heavyweight Nightcap",    tier:"hard",   desc:"O with a top-10% heaviest performer (for your library) after 10pm.",
      test:(a,rp)=> a.heavy && rp.hour>=22 },
    { id:"featherweight-morning",flag:"featherweightMorning",icon:"🪶", name:"Featherweight Morning", tier:"medium", desc:"O with a bottom-10% lightest performer (for your library) between 5-8am.",
      test:(a,rp)=> a.light && rp.hour>=5 && rp.hour<8 },
    { id:"towering-twilight",   flag:"toweringTwilight",   icon:"🗼", name:"Towering Twilight",       tier:"hard",   desc:"O with a top-10% tallest performer (for your library) between 6-8pm.",
      test:(a,rp)=> a.tall && rp.hour>=18 && rp.hour<20 },
    { id:"petite-sunrise",      flag:"petiteSunrise",      icon:"🌄", name:"Petite Sunrise",          tier:"medium", desc:"O with a bottom-10% shortest performer (for your library) between 5-8am.",
      test:(a,rp)=> a.short && rp.hour>=5 && rp.hour<8 },
  ];

  // ── Special-day + performer-characteristic achievements config ───────────
  // Like CHROMA_RULES, but keyed off a specific calendar date rather than a
  // recurring time-of-day/weekday pattern. attrs adds `favorite` and `bodyArt`
  // (booleans) alongside hair/eye/tall/short/heavy/light.
  const HOLIDAY_CHAR_RULES = [
    { id:"christmas-tattoo",   flag:"christmasTattoo",   icon:"🎄", name:"Christmas Ink",         tier:"medium", desc:"O with a tattooed/pierced performer on Christmas Day.",
      test:(a,rp)=> a.bodyArt && rp.month===11 && rp.day===25 },
    { id:"halloween-silverfox",flag:"halloweenSilverFox",icon:"🎃", name:"Halloween Silver Fox",  tier:"hard",   desc:"O with a performer aged 50+ on Halloween.",
      test:(a,rp)=> a.mature50 && rp.month===9 && rp.day===31 },
    { id:"valentines-favorite",flag:"valentinesFavorite",icon:"💘", name:"Valentine's Favorite",  tier:"medium", desc:"O with one of your favorited performers on Valentine's Day.",
      test:(a,rp)=> a.favorite && rp.month===1 && rp.day===14 },
    { id:"newyear-redhead",    flag:"newyearRedhead",    icon:"🥂", name:"New Year, Red Hair",    tier:"medium", desc:"O with a red-haired performer on New Year's Day.",
      test:(a,rp)=> a.hair.has("red") && rp.month===0 && rp.day===1 },
    { id:"friday13-brunette",  flag:"friday13Brunette",  icon:"🔪", name:"Unlucky Brunette",      tier:"hard",   desc:"O with a brunette performer on Friday the 13th.",
      test:(a,rp)=> (a.hair.has("brown")||a.hair.has("brunette")) && rp.weekday===5 && rp.day===13 },
    { id:"independence-blue",  flag:"independenceBlue",  icon:"🎆", name:"Red, White & Blue Eyes",tier:"medium", desc:"O with a blue-eyed performer on July 4th.",
      test:(a,rp)=> a.eye.has("blue") && rp.month===6 && rp.day===4 },
    { id:"christmas-blonde",   flag:"christmasBlonde",   icon:"🎁", name:"Christmas Blonde",      tier:"medium", desc:"O with a blonde performer on Christmas Day.",
      test:(a,rp)=> a.hair.has("blonde") && rp.month===11 && rp.day===25 },
    { id:"halloween-bodyart",  flag:"halloweenBodyArt",  icon:"🕸️", name:"Trick or Ink",          tier:"medium", desc:"O with a tattooed/pierced performer on Halloween.",
      test:(a,rp)=> a.bodyArt && rp.month===9 && rp.day===31 },
  ];


  async function loadAllData() {
    // Step 1: Basic stats
    const mainData = await gqlQuery(`query {
      stats { scene_count performer_count studio_count tag_count }
      rated:     findScenes(scene_filter:{rating100:{value:0,modifier:GREATER_THAN}} filter:{per_page:0}) { count }
      fiveStar:  findScenes(scene_filter:{rating100:{value:100,modifier:EQUALS}}     filter:{per_page:0}) { count }
      organized: findScenes(scene_filter:{organized:true}                             filter:{per_page:0}) { count }
      oScenes:   findScenes(scene_filter:{o_counter:{value:0,modifier:GREATER_THAN}} filter:{per_page:0}) { count }
    }`);

    const sceneOCounterMap = new Map(); // sceneId -> o_counter, used to cross-reference play_count later

    const result = {
      stats:       mainData.stats,
      rated:       mainData.rated.count,
      fiveStar:    mainData.fiveStar.count,
      organized:   mainData.organized.count,
      oScenes:     mainData.oScenes.count,
      oCounterSum: 0, maxSceneOCount: 0, maturePerformerCount: 0,
      hasODetail: false, hasOHistory: false, hasWeight: false,
      oDistinctDays: 0, oLongestStreak: 0,
      youngestOAge: null, oldestOAge: null, oAgeRange: 0,
      maxPerformerSceneCount: 0, maxStudioSceneCount: 0,
      hasTallPerformer: false, hasPetitePerformer: false,
      hasBodyArt: false, birthdayOFound: false,
      oLetters: new Set(), oCountries: new Set(),
      oHairColors: new Set(), oEyeColors: new Set(),
      oDecades: new Set(), oGenders: new Set(), oEthnicities: new Set(),
      timing: {},
      timingRefs: {},
      birthdayInfo: null,
      upcomingBirthday: null,
      heaviestO: null, lightestO: null, tallestO: null, shortestO: null,
      marathonRef: null, quickieRef: null, longNightRef: null,
      wholePackageInfo: null, seniorSiestaInfo: null, midlifeNightInfo: null,
      maxPerformerPlayMins: null,
      oStudioCount: 0, libraryAgeDays: 0, activeMonthCount: 0,
      hasExtra: false,
      imageCount:0, galleryCount:0, scenesDuration:0,
      favoritePerformers:0, watchedScenes:0, maxPlayCount:0,
      groupScenes:0, soloScenes:0, noStudioScenes:0, unratedScenes:0,
      fiveStarPerformers:0, taggedScenes:0, imageCount5k:0, watched500:0,
      hasTagAchievements: false, tagCounts: {},
    };

    // Step 1.5: library-wide height/weight distribution (across ALL performers,
    // not just O'd ones). This lets body-stat achievements be relative to *your*
    // library (median, top/bottom 10%, and the actual tallest/shortest/heaviest/
    // lightest performer(s) you have) instead of fixed absolute cm/kg numbers.
    let libraryTallest = null, libraryShortest = null, libraryHeaviest = null, libraryLightest = null;
    let heightMedian = null, weightMedian = null, heightP90 = null, heightP10 = null, weightP90 = null, weightP10 = null;
    let libraryTallestIds = new Set(), libraryShortestIds = new Set(), libraryHeaviestIds = new Set(), libraryLightestIds = new Set();
    try {
      // findPerformers with per_page:-1 isn't reliable for fetching everything
      // (the existing Step 5 birthday lookup already works around this the same
      // way) — paginate explicitly so a large library's tallest/heaviest/etc.
      // performer can't silently fall outside a truncated result set.
      const list = [];
      let cursor = 0;
      const perPage = 1000;
      while (true) {
        const pg = await gqlQuery(`query($page: Int!, $perPage: Int!) {
          findPerformers(filter:{per_page:$perPage, page:$page}) {
            count
            performers { id name height_cm weight }
          }
        }`, { page: cursor+1, perPage });
        const pageList = pg.findPerformers.performers || [];
        list.push(...pageList);
        cursor++;
        if (pageList.length < perPage || cursor*perPage >= pg.findPerformers.count) break;
      }
      const heights = list.map(p=>({id:p.id,name:p.name||"Unknown",value:Number(p.height_cm)||0})).filter(p=>p.value>0).sort((a,b)=>a.value-b.value);
      const weights = list.map(p=>({id:p.id,name:p.name||"Unknown",value:Number(p.weight)||0})).filter(p=>p.value>0).sort((a,b)=>a.value-b.value);
      if (heights.length) {
        libraryShortest = heights[0];
        libraryTallest  = heights[heights.length-1];
        heightMedian = heights[Math.floor((heights.length-1)/2)].value;
        heightP90    = heights[Math.floor((heights.length-1)*0.9)].value;
        heightP10    = heights[Math.floor((heights.length-1)*0.1)].value;
      }
      if (weights.length) {
        libraryLightest = weights[0];
        libraryHeaviest = weights[weights.length-1];
        weightMedian = weights[Math.floor((weights.length-1)/2)].value;
        weightP90    = weights[Math.floor((weights.length-1)*0.9)].value;
        weightP10    = weights[Math.floor((weights.length-1)*0.1)].value;
      }
      // Simplest possible source of truth for "who is the tallest/shortest/
      // heaviest/lightest performer": scan every performer once for the max/min
      // value, then collect every ID that matches it (ties all included). This
      // set is checked directly against O'd performers later — no comparing two
      // separately-derived numbers against each other, which is what broke before.
      if (libraryTallest)  libraryTallestIds  = new Set(list.filter(p=>(Number(p.height_cm)||0)===libraryTallest.value).map(p=>p.id));
      if (libraryShortest) libraryShortestIds = new Set(list.filter(p=>(Number(p.height_cm)||0)===libraryShortest.value).map(p=>p.id));
      if (libraryHeaviest) libraryHeaviestIds = new Set(list.filter(p=>(Number(p.weight)||0)===libraryHeaviest.value).map(p=>p.id));
      if (libraryLightest) libraryLightestIds = new Set(list.filter(p=>(Number(p.weight)||0)===libraryLightest.value).map(p=>p.id));
    } catch(e) {}
    result.libraryTallest  = libraryTallest;
    result.libraryShortest = libraryShortest;
    result.libraryHeaviest = libraryHeaviest;
    result.libraryLightest = libraryLightest;
    result.heightMedian = heightMedian;
    result.weightMedian = weightMedian;
    result.heightP90 = heightP90;
    result.heightP10 = heightP10;
    result.weightP90 = weightP90;
    result.weightP10 = weightP10;
    result.libraryTallestIds  = libraryTallestIds;
    result.libraryShortestIds = libraryShortestIds;
    result.libraryHeaviestIds = libraryHeaviestIds;
    result.libraryLightestIds = libraryLightestIds;

    // Step 2: O detail (only if there are O'd scenes)
    if (result.oScenes > 0) {
      let scenes = [];
      let hasHistory = false;
      let hasWeight  = true;

      const PERF_FIELDS_W  = "id name birthdate country hair_color eye_color height_cm weight tattoos piercings gender ethnicity created_at favorite";
      const PERF_FIELDS_NW = "id name birthdate country hair_color eye_color height_cm tattoos piercings gender ethnicity created_at favorite";

      async function tryFetch(withHistory, withWeight) {
        const perfFields = withWeight ? PERF_FIELDS_W : PERF_FIELDS_NW;
        const sceneFields = withHistory ? "id title o_counter o_history rating100 paths { screenshot }" : "id title o_counter rating100 paths { screenshot }";
        const data = await gqlQuery(`query {
          findScenes(scene_filter:{o_counter:{value:0,modifier:GREATER_THAN}} filter:{per_page:-1}) {
            scenes {
              ${sceneFields}
              studio { id }
              files { duration }
              performers { ${perfFields} }
            }
          }
        }`);
        return data.findScenes.scenes;
      }

      try {
        scenes = await tryFetch(true, true);
        hasHistory = true; hasWeight = true;
      } catch(e) {
        try {
          scenes = await tryFetch(false, true);
          hasHistory = false; hasWeight = true;
        } catch(e2) {
          try {
            scenes = await tryFetch(true, false);
            hasHistory = true; hasWeight = false;
          } catch(e3) {
            try {
              scenes = await tryFetch(false, false);
              hasHistory = false; hasWeight = false;
            } catch(e4) { scenes = []; }
          }
        }
      }

      result.hasODetail  = true;
      result.hasOHistory = hasHistory;
      result.hasWeight   = hasWeight;

      const matureIds            = new Set();
      let ensembleORef           = null; // O'd scene with 5+ performers
      let instantClassicRef      = null; // perfect-rated scene O'd 3+ times
      let guiltyPleasureRef      = null; // low-rated scene O'd 3+ times anyway
      let shortAndSweetRef       = null; // perfect-rated scene under 10 minutes, O'd
      const oDayKeys             = new Set();
      const oPerformers          = new Map();
      const performerSceneCounts = new Map();
      const perfAdjacency        = new Map(); // performerId -> Map(otherPerformerId -> sceneId they co-star in)
      const performerPlayMins    = new Map(); // performer id -> total minutes across O'd scenes
      const studioSceneCounts    = new Map();
      const studioOSum           = new Map(); // studioId -> total O count across her scenes (counts doubles, unlike distinct scene count)
      const allTimestamps        = [];
      const timing               = {};
      const timingCounts         = {}; // flag -> total number of O events matching (not just "at least one")
      const playtimeByWeekday    = [0,0,0,0,0,0,0]; // index 0=Sun..6=Sat (Rome calendar), minutes
      const timingRefs           = {}; // flag -> { sceneId }
      const dayScenes            = {}; // dateKey -> sceneId (first scene seen for that day)
      let birthdayInfo           = null; // { performerId, performerName, sceneId }
      let heaviestO              = null; // { performerId, performerName, weight, sceneId }
      let lightestO              = null;
      let tallestO                = null;
      let shortestO               = null;
      let marathonRef            = null; // long scene (90+ min) with o_counter>=3
      let ultraMarathonRef       = null; // longer scene (120+ min) with o_counter>=5
      let quickieRef             = null; // short O'd scene (<5 min)
      let speedRunRef            = null; // very short O'd scene (<3 min)
      let longNightRef           = null; // O after midnight on a 60+ min scene
      let wholePackageInfo       = null; // tattoos + piercings + tall performer
      let seniorSiestaInfo       = null; // 60+ performer O'd during siesta hours
      let midlifeNightInfo       = null; // 40-50yo performer O'd during night owl hours
      let youngestOInfo          = null; // { performerId, performerName, age, sceneId }
      let oldestOInfo            = null;
      let bodyArtInfo            = null; // { performerId, performerName, sceneId } - first performer with tattoos/piercings
      let ageComboInfo           = null; // { sum, sceneId, names } - two oldest performers in one O'd scene
      const performerFirstO      = new Map(); // performerId -> earliest O timestamp (ms) across their scenes

      // Counters (in addition to "first match" refs above) so achievements can
      // show a real "Total: N" count, not just "at least one exists".
      let ensembleOCount = 0, instantClassicCount = 0, guiltyPleasureCount = 0, shortAndSweetCount = 0;
      let marathonCount = 0, ultraMarathonCount = 0, quickieCount = 0, speedRunCount = 0, longNightCount = 0;
      let seniorSiestaCount = 0, midlifeNightCount = 0, wholePackageCount = 0;
      const tallPerformerIds   = new Set(); // O'd performers taller than the library median
      const petitePerformerIds = new Set(); // O'd performers shorter than the library median
      const bodyArtPerformerIds = new Set(); // O'd performers with tattoos/piercings
      const top10TallIds   = new Set(); // O'd performers in the library's tallest 10%
      const bottom10ShortIds = new Set(); // O'd performers in the library's shortest 10%
      const top10HeavyIds  = new Set(); // O'd performers in the library's heaviest 10%
      const bottom10LightIds = new Set(); // O'd performers in the library's lightest 10%
      const recordTallIds   = new Set(); // O'd performers who are (one of) the tallest in the whole library
      const recordShortIds  = new Set(); // O'd performers who are (one of) the shortest in the whole library
      const recordHeavyIds  = new Set(); // O'd performers who are (one of) the heaviest in the whole library
      const recordLightIds  = new Set(); // O'd performers who are (one of) the lightest in the whole library
      let giantMatch = null, pocketSizeMatch = null, bantamweightMatch = null, superHeavyweightMatch = null;
      // playtimeScenesByWeekday[dow] lists the scenes behind that weekday's Playtime
      // Patterns total, so the achievement can pop up "here's what you watched".
      const playtimeScenesByWeekday = [[],[],[],[],[],[],[]];

      for (const scene of scenes) {
        const count = scene.o_counter || 0;
        result.oCounterSum += count;
        if (count > result.maxSceneOCount) { result.maxSceneOCount = count; result.maxSceneOCountSceneId = scene.id; }
        sceneOCounterMap.set(scene.id, count);

        if (count > 0) {
          const sceneDurMins = (scene.files && scene.files[0] && scene.files[0].duration) ? scene.files[0].duration / 60 : 0;
          const castSize = (scene.performers || []).length;
          if (castSize >= 5) { ensembleOCount++; if (!ensembleORef) ensembleORef = { sceneId: scene.id }; }
          if (scene.rating100 === 100 && count >= 3) { instantClassicCount++; if (!instantClassicRef) instantClassicRef = { sceneId: scene.id }; }
          if (scene.rating100 != null && scene.rating100 < 50 && count >= 3) { guiltyPleasureCount++; if (!guiltyPleasureRef) guiltyPleasureRef = { sceneId: scene.id }; }
          if (scene.rating100 === 100 && sceneDurMins > 0 && sceneDurMins < 10) { shortAndSweetCount++; if (!shortAndSweetRef) shortAndSweetRef = { sceneId: scene.id }; }
          for (const p of (scene.performers || [])) {
            const age = getAge(p.birthdate);
            const hCm = Number(p.height_cm) || 0; // coerce defensively: a stray string value would silently break numeric comparisons/sorts below
            const wKg = Number(p.weight) || 0;
            if (age !== null && age >= 50) matureIds.add(p.id);
            if (age !== null) {
              if (!youngestOInfo || age < youngestOInfo.age) youngestOInfo = { performerId:p.id, performerName:p.name||"Unknown", age, sceneId:scene.id };
              if (!oldestOInfo   || age > oldestOInfo.age)   oldestOInfo   = { performerId:p.id, performerName:p.name||"Unknown", age, sceneId:scene.id };
            }
            if ((p.tattoos||"").trim() || (p.piercings||"").trim()) {
              bodyArtPerformerIds.add(p.id);
              if (!bodyArtInfo) bodyArtInfo = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id };
            }
            if (!oPerformers.has(p.id)) oPerformers.set(p.id, p);
            if (!performerSceneCounts.has(p.id)) performerSceneCounts.set(p.id, new Set());
            performerSceneCounts.get(p.id).add(scene.id);
            performerPlayMins.set(p.id, (performerPlayMins.get(p.id)||0) + sceneDurMins);
            if (heightMedian!=null && hCm > heightMedian) { result.hasTallPerformer = true; tallPerformerIds.add(p.id); }
            if (heightMedian!=null && hCm > 0 && hCm < heightMedian) { result.hasPetitePerformer = true; petitePerformerIds.add(p.id); }
            if (heightP90!=null && hCm >= heightP90) top10TallIds.add(p.id);
            if (heightP10!=null && hCm > 0 && hCm <= heightP10) bottom10ShortIds.add(p.id);
            if (libraryTallestIds.has(p.id))  { recordTallIds.add(p.id);  if (!giantMatch) giantMatch = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id }; }
            if (libraryShortestIds.has(p.id)) { recordShortIds.add(p.id); if (!pocketSizeMatch) pocketSizeMatch = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id }; }
            if (hasWeight && weightP90!=null && wKg >= weightP90) top10HeavyIds.add(p.id);
            if (hasWeight && weightP10!=null && wKg > 0 && wKg <= weightP10) bottom10LightIds.add(p.id);
            if (hasWeight && libraryHeaviestIds.has(p.id)) { recordHeavyIds.add(p.id); if (!superHeavyweightMatch) superHeavyweightMatch = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id }; }
            if (hasWeight && libraryLightestIds.has(p.id)) { recordLightIds.add(p.id); if (!bantamweightMatch) bantamweightMatch = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id }; }
            if ((p.tattoos||"").trim() || (p.piercings||"").trim()) result.hasBodyArt = true;
            if ((p.tattoos||"").trim() && (p.piercings||"").trim() && heightMedian!=null && hCm > heightMedian) {
              wholePackageCount++;
              if (!wholePackageInfo) wholePackageInfo = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id };
            }
            if (hasWeight && wKg > 0) {
              if (!heaviestO || wKg > heaviestO.weight) heaviestO = { performerId:p.id, performerName:p.name||"Unknown", weight:wKg, sceneId:scene.id };
              if (!lightestO || wKg < lightestO.weight) lightestO = { performerId:p.id, performerName:p.name||"Unknown", weight:wKg, sceneId:scene.id };
            }
            if (hCm > 0) {
              if (!tallestO || hCm > tallestO.height) tallestO = { performerId:p.id, performerName:p.name||"Unknown", height:hCm, sceneId:scene.id };
              if (!shortestO || hCm < shortestO.height) shortestO = { performerId:p.id, performerName:p.name||"Unknown", height:hCm, sceneId:scene.id };
            }
            if (p.gender)    result.oGenders.add(p.gender);
            if (p.ethnicity) result.oEthnicities.add(p.ethnicity);
            if (p.birthdate) {
              const bd = new Date(p.birthdate);
              if (!isNaN(bd.getTime())) {
                result.oDecades.add(Math.floor(bd.getFullYear()/10)*10);
                const today = getRomeToday();
                if (bd.getMonth()===today.month && bd.getDate()===today.day) {
                  result.birthdayOFound = true;
                  if (!birthdayInfo) birthdayInfo = { performerId:p.id, performerName:p.name||"Unknown", sceneId:scene.id };
                }
              }
            }
            if (p.name) { const l = p.name.trim()[0].toUpperCase(); if (l>="A"&&l<="Z") result.oLetters.add(l); }
            if (p.country)    result.oCountries.add(p.country);
            if (p.hair_color) result.oHairColors.add(p.hair_color);
            if (p.eye_color)  result.oEyeColors.add(p.eye_color);
          }
          // Age Combo: sum of the two oldest performers (with known age) in this O'd scene
          // Chain adjacency: any two performers who co-star in this O'd scene are
          // linked (edge stores the connecting scene, first one found wins).
          const scenePerfList = scene.performers || [];
          for (let ii=0; ii<scenePerfList.length; ii++) {
            for (let jj=ii+1; jj<scenePerfList.length; jj++) {
              const pidA = scenePerfList[ii].id, pidB = scenePerfList[jj].id;
              if (pidA === pidB) continue;
              if (!perfAdjacency.has(pidA)) perfAdjacency.set(pidA, new Map());
              if (!perfAdjacency.has(pidB)) perfAdjacency.set(pidB, new Map());
              if (!perfAdjacency.get(pidA).has(pidB)) perfAdjacency.get(pidA).set(pidB, scene.id);
              if (!perfAdjacency.get(pidB).has(pidA)) perfAdjacency.get(pidB).set(pidA, scene.id);
            }
          }

          const scenePerformerAges = (scene.performers||[]).map(p=>getAge(p.birthdate)).filter(a=>a!==null).sort((a,b)=>b-a);
          if (scenePerformerAges.length >= 2) {
            const sum = scenePerformerAges[0] + scenePerformerAges[1];
            if (!ageComboInfo || sum > ageComboInfo.sum) ageComboInfo = { sum, sceneId: scene.id };
          }
          if (scene.studio) {
            if (!studioSceneCounts.has(scene.studio.id)) studioSceneCounts.set(scene.studio.id, new Set());
            studioSceneCounts.get(scene.studio.id).add(scene.id);
            studioOSum.set(scene.studio.id, (studioOSum.get(scene.studio.id)||0) + count);
          }

          // Marathon: a 90+ minute scene with 3+ O's
          if (sceneDurMins >= 90 && count >= 3) {
            marathonCount++;
            if (!marathonRef) marathonRef = { sceneId: scene.id };
          }
          // Ultra Marathon: a 120+ minute scene with 5+ O's
          if (sceneDurMins >= 120 && count >= 5) {
            ultraMarathonCount++;
            if (!ultraMarathonRef) ultraMarathonRef = { sceneId: scene.id };
          }
          // Quickie: an O'd scene under 5 minutes long
          if (sceneDurMins > 0 && sceneDurMins < 5) {
            quickieCount++;
            if (!quickieRef) quickieRef = { sceneId: scene.id };
          }
          // Speed Run: an O'd scene under 3 minutes long
          if (sceneDurMins > 0 && sceneDurMins < 3) {
            speedRunCount++;
            if (!speedRunRef) speedRunRef = { sceneId: scene.id };
          }
        }

        if (hasHistory) {
          const performers = scene.performers || [];
          const sceneHasMature  = performers.some(p => (getAge(p.birthdate)||0) >= 50);
          const sceneHasSenior  = performers.some(p => (getAge(p.birthdate)||0) >= 60);
          const sceneHasMidlife = performers.some(p => { const a=getAge(p.birthdate); return a!==null && a>=40 && a<=50; });
          const sceneHasBodyArt = performers.some(p => (p.tattoos||"").trim() || (p.piercings||"").trim());
          const sceneCountries  = new Set(performers.map(p=>p.country).filter(Boolean));
          const sceneDurMins    = (scene.files && scene.files[0] && scene.files[0].duration) ? scene.files[0].duration / 60 : 0;
          // Body-stat attribute bundle for the CHROMA_RULES (hair/eye colour + height/weight)
          // and HOLIDAY_CHAR_RULES (adds favorite/body-art/mature50).
          const chromaAttrs = {
            hair: new Set(performers.map(p=>(p.hair_color||"").trim().toLowerCase()).filter(Boolean)),
            eye:  new Set(performers.map(p=>(p.eye_color||"").trim().toLowerCase()).filter(Boolean)),
            tall:  heightP90!=null && performers.some(p=>(Number(p.height_cm)||0)>=heightP90),
            short: heightP10!=null && performers.some(p=>(Number(p.height_cm)||0)>0 && (Number(p.height_cm)||0)<=heightP10),
            heavy: hasWeight && weightP90!=null && performers.some(p=>(Number(p.weight)||0)>=weightP90),
            light: hasWeight && weightP10!=null && performers.some(p=>(Number(p.weight)||0)>0 && (Number(p.weight)||0)<=weightP10),
            favorite: performers.some(p=>p.favorite),
            bodyArt: sceneHasBodyArt,
            mature50: sceneHasMature,
          };

          // Double/Triple Shot must be the SAME scene's own O's happening close together,
          // not two unrelated scenes that happen to fall within the window of each other.
          const sceneTimestamps = (scene.o_history || [])
            .map(ts => new Date(ts))
            .filter(dt => !isNaN(dt.getTime()))
            .sort((a,b) => a-b);
          for (let si = 1; si < sceneTimestamps.length; si++) {
            const diff = sceneTimestamps[si] - sceneTimestamps[si-1];
            if (diff <= 1800000) { timingCounts.doubleShot = (timingCounts.doubleShot||0)+1; if (!timing.doubleShot) { timing.doubleShot = true; timingRefs.doubleShot = { sceneId: scene.id }; } }
            if (si > 1 && sceneTimestamps[si] - sceneTimestamps[si-2] <= 3600000) { timingCounts.tripleShot = (timingCounts.tripleShot||0)+1; if (!timing.tripleShot) { timing.tripleShot = true; timingRefs.tripleShot = { sceneId: scene.id }; } }
          }

          for (const ts of (scene.o_history || [])) {
            const d = new Date(ts);
            if (isNaN(d.getTime())) continue;
            allTimestamps.push({ d, sceneId: scene.id });
            const rp = getRomeParts(d);
            const tms = d.getTime();
            performers.forEach(p => {
              if (!performerFirstO.has(p.id) || tms < performerFirstO.get(p.id)) performerFirstO.set(p.id, tms);
            });
            const h2 = rp.hour, dow = rp.weekday, mo = rp.month, dy = rp.day, mn = rp.minute;
            const setFlag = (key) => {
              timingCounts[key] = (timingCounts[key]||0) + 1;
              if (!timing[key]) { timing[key] = true; timingRefs[key] = { sceneId: scene.id }; }
            };
            if (h2>=0&&h2<5)   setFlag("nightOwl");
            if (h2>=5&&h2<8)   setFlag("earlyBird");
            if (h2===12)       setFlag("lunchBreak");
            if (h2===3)        setFlag("witchingHour");
            if ((dow===5&&h2>=21)||(dow===6&&h2<3)) setFlag("fridayNight");
            if (dow===0||dow===6) setFlag("weekendWarrior");
            if (dow===3) setFlag("humpDay");
            if (dow===6&&h2>=6&&h2<10) setFlag("saturdayCartoons");
            if (dow===0&&h2>=18&&h2<22) setFlag("sundayScaries");
            if (dow===5&&dy===13) setFlag("fridayThe13th");
            if (mo===6&&dy===4)   setFlag("independenceDay");
            if (mo===0&&dy===1)   setFlag("freshStart");
            if (dow===1&&h2>=6&&h2<9) setFlag("mondayMorning");
            if (h2>=14&&h2<16) setFlag("siesta");
            if (mo===9&&dy===31) setFlag("halloweenO");
            if (mo===11&&dy===25) setFlag("christmasO");
            if (mo===1&&dy===14)  setFlag("valentinesO");
            const HOLIDAYS=[[0,1],[1,14],[11,25],[11,31],[9,31],[6,4]];
            if (HOLIDAYS.some(([m,dd])=>m===mo&&dd===dy)) setFlag("holidayO");
            if ((mo===11&&dy===31&&h2===23&&mn>=55)||(mo===0&&dy===1&&h2===0&&mn<=5)) setFlag("newYearsCountdown");
            if (sceneHasMature&&(h2>=22||h2<4)) setFlag("matureNightcap");
            if (sceneCountries.size>0&&(dow===0||dow===6)&&h2>=13&&h2<18) setFlag("sundayMatinee");
            if (sceneHasBodyArt&&h2===0) setFlag("midnightRebellion");
            CHROMA_RULES.forEach(rule => { if (rule.test(chromaAttrs, rp)) setFlag(rule.flag); });
            HOLIDAY_CHAR_RULES.forEach(rule => { if (rule.test(chromaAttrs, rp)) setFlag(rule.flag); });
            // Accumulate watch time by weekday (Rome calendar), for the Playtime
            // Patterns achievements — every O event on scene of duration sceneDurMins
            // contributes that scene's runtime to the day it happened on.
            playtimeByWeekday[dow] = (playtimeByWeekday[dow]||0) + sceneDurMins;
            playtimeScenesByWeekday[dow].push({ id:scene.id, title:scene.title||"(Untitled scene)", screenshot:(scene.paths&&scene.paths.screenshot)||null, rating100:scene.rating100, durMins:sceneDurMins, diffDaysLabel:dateKey(d) });
            // Senior Discount: O during siesta hours (2-4pm) with a 60+ performer
            if (sceneHasSenior && h2>=14 && h2<16) {
              seniorSiestaCount++;
              if (!seniorSiestaInfo) seniorSiestaInfo = { sceneId: scene.id };
            }
            // Midlife Crisis: O between midnight and 5am with a 40-50yo performer
            if (sceneHasMidlife && h2>=0 && h2<5) {
              midlifeNightCount++;
              if (!midlifeNightInfo) midlifeNightInfo = { sceneId: scene.id };
            }
            // The Long Haul: O after midnight (0-5am) on a scene 60+ minutes long
            if (h2>=0 && h2<5 && sceneDurMins>=60) {
              longNightCount++;
              if (!longNightRef) longNightRef = { sceneId: scene.id };
            }
            const dk = dateKey(d);
            oDayKeys.add(dk);
            if (!dayScenes[dk]) dayScenes[dk] = scene.id;
          }
        }
      }

      result.maturePerformerCount = matureIds.size;

      // Performer Chain: longest "chain" of O'd performers connected through
      // shared scenes (A co-starred with B, B co-starred with C, ...). Exact
      // longest-simple-path is NP-hard in general graphs, so we approximate the
      // diameter with the standard double-sweep BFS (BFS from any node to find
      // the farthest node A, then BFS from A to find the farthest node B — the
      // A→B path is a very close approximation of the true longest chain).
      function bfsFarthest(start, adjacency) {
        const dist = new Map([[start, 0]]);
        const prev = new Map();
        const queue = [start];
        let farthest = start, farthestDist = 0;
        for (let qi = 0; qi < queue.length; qi++) {
          const cur = queue[qi];
          const neighbors = adjacency.get(cur);
          if (!neighbors) continue;
          neighbors.forEach((sceneId, nb) => {
            if (!dist.has(nb)) {
              const d2 = dist.get(cur) + 1;
              dist.set(nb, d2);
              prev.set(nb, { from: cur, sceneId });
              queue.push(nb);
              if (d2 > farthestDist) { farthestDist = d2; farthest = nb; }
            }
          });
        }
        return { dist, prev, farthest, farthestDist };
      }

      let bestChain = { length: 0, path: [], links: [] };
      const chainVisited = new Set();
      perfAdjacency.forEach((_, pid) => {
        if (chainVisited.has(pid)) return;
        const sweep1 = bfsFarthest(pid, perfAdjacency);
        sweep1.dist.forEach((_, nodeId) => chainVisited.add(nodeId));
        const sweep2 = bfsFarthest(sweep1.farthest, perfAdjacency);
        if (sweep2.farthestDist > bestChain.length) {
          const path = [];
          let cur = sweep2.farthest;
          while (cur !== undefined) {
            path.push(cur);
            const p = sweep2.prev.get(cur);
            if (!p) break;
            cur = p.from;
          }
          path.reverse();
          const links = [];
          for (let i = 1; i < path.length; i++) {
            links.push({ sceneId: sweep2.prev.get(path[i]).sceneId, fromId: path[i-1], toId: path[i] });
          }
          bestChain = { length: sweep2.farthestDist, path, links };
        }
      });
      result.performerChain = {
        length: bestChain.length,
        path: bestChain.path.map(pid => ({ performerId: pid, performerName: (oPerformers.get(pid)&&oPerformers.get(pid).name)||"Unknown" })),
        links: bestChain.links,
      };

      let maxScenePerformer = null;
      performerSceneCounts.forEach((s,pid) => {
        if (s.size>result.maxPerformerSceneCount) result.maxPerformerSceneCount=s.size;
        if (!maxScenePerformer || s.size > maxScenePerformer.count) {
          const p = oPerformers.get(pid);
          maxScenePerformer = { performerId: pid, performerName: (p&&p.name)||"Unknown", count: s.size };
        }
      });
      result.maxScenePerformerInfo = maxScenePerformer;
      result.youngestOInfo = youngestOInfo;
      result.oldestOInfo   = oldestOInfo;
      result.bodyArtInfo   = bodyArtInfo;
      result.ageComboInfo  = ageComboInfo;
      studioSceneCounts.forEach(s    => { if (s.size>result.maxStudioSceneCount)    result.maxStudioSceneCount=s.size; });
      result.oStudioCount = studioSceneCounts.size;
      let maxStudioOSum = 0;
      studioOSum.forEach(sum => { if (sum > maxStudioOSum) maxStudioOSum = sum; });
      result.maxStudioOSum = maxStudioOSum;

      // Rookie/Veteran: compare each performer's library add date (created_at) against
      // the earliest O they received.
      let rookieCount = 0, veteranCount = 0, rookieInfo = null, veteranInfo = null;
      const rookiePerformersAll = [], veteranPerformersAll = [];
      performerFirstO.forEach((firstOTime, pid) => {
        const p = oPerformers.get(pid);
        if (!p || !p.created_at) return;
        const createdTime = new Date(p.created_at).getTime();
        if (isNaN(createdTime)) return;
        const diffDays = (firstOTime - createdTime) / 86400000;
        if (diffDays >= 0 && diffDays <= 30) {
          rookieCount++;
          if (!rookieInfo) rookieInfo = { performerId:pid, performerName:p.name||"Unknown" };
          rookiePerformersAll.push({ performerId:pid, performerName:p.name||"Unknown", image_path:p.image_path||null, days:Math.round(diffDays*10)/10 });
        }
        if (diffDays >= 730) {
          veteranCount++;
          if (!veteranInfo) veteranInfo = { performerId:pid, performerName:p.name||"Unknown" };
          veteranPerformersAll.push({ performerId:pid, performerName:p.name||"Unknown", image_path:p.image_path||null, days:Math.round(diffDays) });
        }
      });
      result.rookieCount = rookieCount;
      result.veteranCount = veteranCount;
      result.rookieInfo = rookieInfo;
      result.veteranInfo = veteranInfo;
      result.rookiePerformersAll = rookiePerformersAll;
      result.veteranPerformersAll = veteranPerformersAll;

      // Performer of the Year, across years: who tops each year, using the SAME weighted
      // score formula as the podium tab (scorePodiumPerformer), not just raw O count —
      // otherwise this could disagree with what's shown on that page.
      const yearPerformerFullStats = new Map(); // year -> Map(performerId -> stats for scorePodiumPerformer)
      scenes.forEach(scene => {
        const history = scene.o_history || [];
        if (!history.length) return;
        const durMins = (scene.files && scene.files[0] && scene.files[0].duration) ? scene.files[0].duration / 60 : 0;
        const sceneRatingNorm = scene.rating100!=null ? scene.rating100/100 : 0.6;
        const byYear = {};
        history.forEach(ts => { const dt=new Date(ts); if (!isNaN(dt.getTime())) { const yr=getRomeParts(dt).year; byYear[yr]=(byYear[yr]||0)+1; } });
        Object.entries(byYear).forEach(([yr,oCount]) => {
          const y = Number(yr);
          const qualityMins = durMins * sceneRatingNorm * oCount;
          if (!yearPerformerFullStats.has(y)) yearPerformerFullStats.set(y, new Map());
          const pmap = yearPerformerFullStats.get(y);
          (scene.performers||[]).forEach(p => {
            if (!pmap.has(p.id)) pmap.set(p.id, { performerId:p.id, performerName:p.name||"Unknown", oCount:0, sceneCount:0, playMins:0, qualityMins:0, ratingSum:0, ratingCount:0, isFavorite:!!p.favorite });
            const s = pmap.get(p.id);
            s.oCount += oCount; s.sceneCount += 1; s.playMins += durMins; s.qualityMins += qualityMins;
            if (scene.rating100!=null) { s.ratingSum += scene.rating100; s.ratingCount += 1; }
          });
        });
      });
      const yearTop = {};
      yearPerformerFullStats.forEach((pmap, yr) => {
        let best = null;
        pmap.forEach(s => {
          const score = scorePodiumPerformer({ ...s, avgRating: s.ratingCount>0 ? s.ratingSum/s.ratingCount : 0 });
          if (!best || score > best.score) best = { performerId:s.performerId, performerName:s.performerName, score };
        });
        if (best) yearTop[yr] = best;
      });
      const champCounts = {};
      Object.values(yearTop).forEach(entry => { champCounts[entry.performerId] = (champCounts[entry.performerId]||0) + 1; });
      let champ = null;
      Object.entries(champCounts).forEach(([pid,cnt]) => { if (!champ || cnt > champ.count) champ = { performerId:pid, count:cnt }; });
      if (champ) {
        const p = oPerformers.get(champ.performerId);
        result.repeatChampion = { performerId:champ.performerId, performerName:(p&&p.name)||"Unknown", years:champ.count };
      } else { result.repeatChampion = null; }
      const curYear = getRomeToday().year;
      if (yearTop[curYear] && yearTop[curYear-1] && yearTop[curYear].performerId !== yearTop[curYear-1].performerId) {
        result.guardChanged = { performerId:yearTop[curYear].performerId, performerName:yearTop[curYear].performerName };
      } else { result.guardChanged = null; }

      // Monthly Breakdown competitiveness: same weighted score formula as the
      // Monthly Breakdown tab, but grouped by calendar month instead of year, to
      // find the month with the most distinct scoring performers (Crowded Field/
      // Packed House) and the month with the tightest #1-vs-#2 race (Photo Finish).
      const monthPerformerStats = new Map(); // "YYYY-MM" -> Map(performerId -> stats)
      scenes.forEach(scene => {
        const history = scene.o_history || [];
        if (!history.length) return;
        const durMins = (scene.files && scene.files[0] && scene.files[0].duration) ? scene.files[0].duration / 60 : 0;
        const sceneRatingNorm = scene.rating100!=null ? scene.rating100/100 : 0.6;
        const byMonth = {};
        history.forEach(ts => { const dt=new Date(ts); if (!isNaN(dt.getTime())) { const rp2=getRomeParts(dt); const mk=`${rp2.year}-${String(rp2.month+1).padStart(2,"0")}`; byMonth[mk]=(byMonth[mk]||0)+1; } });
        Object.entries(byMonth).forEach(([mk,oCount]) => {
          const qualityMins = durMins * sceneRatingNorm * oCount;
          if (!monthPerformerStats.has(mk)) monthPerformerStats.set(mk, new Map());
          const pmap = monthPerformerStats.get(mk);
          (scene.performers||[]).forEach(p => {
            if (!pmap.has(p.id)) pmap.set(p.id, { performerId:p.id, performerName:p.name||"Unknown", oCount:0, sceneCount:0, playMins:0, qualityMins:0, ratingSum:0, ratingCount:0, isFavorite:!!p.favorite });
            const s = pmap.get(p.id);
            s.oCount += oCount; s.sceneCount += 1; s.playMins += durMins; s.qualityMins += qualityMins;
            if (scene.rating100!=null) { s.ratingSum += scene.rating100; s.ratingCount += 1; }
          });
        });
      });
      let maxCompetitorsMonth = 0, maxCompetitorsInfo = null;
      let closestRaceGap = Infinity, closestRaceInfo = null;
      monthPerformerStats.forEach((pmap, mk) => {
        if (pmap.size > maxCompetitorsMonth) { maxCompetitorsMonth = pmap.size; maxCompetitorsInfo = { month:mk, count:pmap.size }; }
        if (pmap.size >= 2) {
          const scored = Array.from(pmap.values())
            .map(s => ({ performerId:s.performerId, performerName:s.performerName, score:scorePodiumPerformer({ ...s, avgRating: s.ratingCount>0 ? s.ratingSum/s.ratingCount : 0 }) }))
            .sort((a,b)=>b.score-a.score);
          const gap = scored[0].score - scored[1].score;
          if (gap < closestRaceGap) { closestRaceGap = gap; closestRaceInfo = { month:mk, gap, top:scored[0], second:scored[1] }; }
        }
      });
      result.maxCompetitorsMonth = maxCompetitorsMonth;
      result.maxCompetitorsInfo  = maxCompetitorsInfo;
      result.closestRaceGap  = closestRaceGap === Infinity ? null : closestRaceGap;
      result.closestRaceInfo = closestRaceInfo;

      // "Going the Distance": performer with the most cumulative watch time across O'd scenes
      let maxPlayMinsPerformer = null;
      performerPlayMins.forEach((mins, pid) => {
        if (!maxPlayMinsPerformer || mins > maxPlayMinsPerformer.mins) {
          const p = oPerformers.get(pid);
          maxPlayMinsPerformer = { performerId: pid, performerName: (p&&p.name)||"Unknown", mins };
        }
      });
      result.maxPerformerPlayMins = maxPlayMinsPerformer;

      const ages = Array.from(oPerformers.values()).map(p=>getAge(p.birthdate)).filter(a=>a!==null);
      if (ages.length) {
        result.youngestOAge = Math.min(...ages);
        result.oldestOAge   = Math.max(...ages);
        result.oAgeRange    = result.oldestOAge - result.youngestOAge;
      }

      // If nobody's birthday is today, the soonest upcoming birthday (across ALL
      // performers, not just O'd ones) is computed separately below.

      if (hasHistory && allTimestamps.length) {
        result.oDistinctDays  = oDayKeys.size;
        result.oLongestStreak = longestStreak(oDayKeys);
        allTimestamps.sort((a,b)=>a.d-b.d);
        const dayCounts = {};
        const dayCountScene = {};
        const dayScenesAll = {};
        const seenOScenes = new Set();
        const oScenesChronological = [];
        allTimestamps.forEach((entry,i) => {
          const { d, sceneId } = entry;
          const k = dateKey(d);
          dayCounts[k] = (dayCounts[k]||0)+1;
          dayCountScene[k] = sceneId;
          if (!dayScenesAll[k]) dayScenesAll[k] = new Set();
          dayScenesAll[k].add(sceneId);
          if (!seenOScenes.has(sceneId)) { seenOScenes.add(sceneId); oScenesChronological.push(sceneId); }
        });
        const threeOfKindDays = [];
        for (const [k,n] of Object.entries(dayCounts)) {
          if (n>=5) { timingCounts.fiveInOneDay = (timingCounts.fiveInOneDay||0)+1; if (!timing.fiveInOneDay) { timing.fiveInOneDay = true; timingRefs.fiveInOneDay = { sceneId: dayCountScene[k] }; } }
          if (n>=3) threeOfKindDays.push({ date:k, sceneIds:Array.from(dayScenesAll[k]) });
        }
        result.threeOfKindDays = threeOfKindDays;
        result.oSceneMilestones = {
          10:  oScenesChronological[9]  || null,
          50:  oScenesChronological[49] || null,
          100: oScenesChronological[99] || null,
        };
      }
      result.timing = timing;
      result.timingRefs = timingRefs;
      result.timingCounts = timingCounts;
      result.playtimeByWeekday = playtimeByWeekday;
      result.playtimeScenesByWeekday = playtimeScenesByWeekday;
      result.birthdayInfo = birthdayInfo;
      result.heaviestO = heaviestO;
      result.lightestO = lightestO;
      result.tallestO = tallestO;
      result.shortestO = shortestO;
      result.marathonRef = marathonRef;
      result.ultraMarathonRef = ultraMarathonRef;
      result.quickieRef = quickieRef;
      result.speedRunRef = speedRunRef;
      result.ensembleORef = ensembleORef;
      result.instantClassicRef = instantClassicRef;
      result.guiltyPleasureRef = guiltyPleasureRef;
      result.shortAndSweetRef = shortAndSweetRef;
      result.longNightRef = longNightRef;
      result.wholePackageInfo = wholePackageInfo;
      result.seniorSiestaInfo = seniorSiestaInfo;
      result.midlifeNightInfo = midlifeNightInfo;
      result.ensembleOCount = ensembleOCount;
      result.instantClassicCount = instantClassicCount;
      result.guiltyPleasureCount = guiltyPleasureCount;
      result.shortAndSweetCount = shortAndSweetCount;
      result.marathonCount = marathonCount;
      result.ultraMarathonCount = ultraMarathonCount;
      result.quickieCount = quickieCount;
      result.speedRunCount = speedRunCount;
      result.longNightCount = longNightCount;
      result.seniorSiestaCount = seniorSiestaCount;
      result.midlifeNightCount = midlifeNightCount;
      result.wholePackageCount = wholePackageCount;
      result.tallPerformerCount = tallPerformerIds.size;
      result.petitePerformerCount = petitePerformerIds.size;
      result.bodyArtPerformerCount = bodyArtPerformerIds.size;
      result.top10TallCount = top10TallIds.size;
      result.bottom10ShortCount = bottom10ShortIds.size;
      result.top10HeavyCount = top10HeavyIds.size;
      result.bottom10LightCount = bottom10LightIds.size;
      result.recordTallCount = recordTallIds.size;
      result.recordShortCount = recordShortIds.size;
      result.recordHeavyCount = recordHeavyIds.size;
      result.recordLightCount = recordLightIds.size;
      result.giantMatch = giantMatch;
      result.pocketSizeMatch = pocketSizeMatch;
      result.bantamweightMatch = bantamweightMatch;
      result.superHeavyweightMatch = superHeavyweightMatch;

      // Scene list behind the O Counter sum achievements (On Fire / Legendary /
      // The Emperor), sorted by O count so the biggest contributors show first.
      result.oCounterTopScenes = scenes
        .filter(s => (s.o_counter||0) > 0)
        .map(s => ({
          id:s.id, title:s.title||"(Untitled scene)",
          screenshot:(s.paths&&s.paths.screenshot)||null,
          rating100:s.rating100,
          durMins:(s.files&&s.files[0]&&s.files[0].duration)?s.files[0].duration/60:0,
          oCounter:s.o_counter||0,
          performerNames:(s.performers||[]).map(p=>p.name).filter(Boolean),
        }))
        .sort((a,b)=>b.oCounter-a.oCounter);
    }

    // Step 3: Extra stats (best-effort)
    try {
      const ex = await gqlQuery(`query {
        stats { image_count gallery_count scenes_duration }
        favoritePerformers: findPerformers(performer_filter:{filter_favorites:true} filter:{per_page:0}) { count }
        watchedScenes: findScenes(scene_filter:{play_count:{value:0,modifier:GREATER_THAN}} filter:{per_page:0}) { count }
      }`);
      result.hasExtra        = true;
      result.imageCount      = ex.stats.image_count    || 0;
      result.galleryCount    = ex.stats.gallery_count  || 0;
      result.scenesDuration  = ex.stats.scenes_duration|| 0;
      result.favoritePerformers = ex.favoritePerformers.count || 0;
      result.watchedScenes   = ex.watchedScenes.count  || 0;
    } catch(e) {}

    // Extra stats part 2 - filters that may not exist in all versions.
    // Each is fetched independently so a single unsupported filter doesn't
    // silently zero out the others.
    if (result.hasExtra) {
      try {
        const r = await gqlQuery(`query { groupScenes: findScenes(scene_filter:{performer_count:{value:2,modifier:GREATER_THAN}} filter:{per_page:0}) { count } }`);
        result.groupScenes = (r.groupScenes && r.groupScenes.count) || 0;
      } catch(e) {}

      try {
        const r = await gqlQuery(`query { soloScenes: findScenes(scene_filter:{performer_count:{value:1,modifier:EQUALS}} filter:{per_page:0}) { count } }`);
        result.soloScenes = (r.soloScenes && r.soloScenes.count) || 0;
      } catch(e) {}

      try {
        const r = await gqlQuery(`query { unratedScenes: findScenes(scene_filter:{rating100:{value:0,modifier:IS_NULL}} filter:{per_page:0}) { count } }`);
        result.unratedScenes = (r.unratedScenes && r.unratedScenes.count) || 0;
      } catch(e) {}

      try {
        const r = await gqlQuery(`query { fiveStarPerfs: findPerformers(performer_filter:{rating100:{value:100,modifier:EQUALS}} filter:{per_page:0}) { count } }`);
        result.fiveStarPerformers = (r.fiveStarPerfs && r.fiveStarPerfs.count) || 0;
      } catch(e) {}

      try {
        const r = await gqlQuery(`query { taggedScenes: findScenes(scene_filter:{tags:{modifier:NOT_NULL}} filter:{per_page:0}) { count } }`);
        result.taggedScenes = (r.taggedScenes && r.taggedScenes.count) || 0;
      } catch(e) {}

      try {
        const r = await gqlQuery(`query { noStudioScenes: findScenes(scene_filter:{studios:{modifier:IS_NULL}} filter:{per_page:0}) { count } }`);
        result.noStudioScenes = (r.noStudioScenes && r.noStudioScenes.count) || 0;
      } catch(e) {}

      try {
        const r = await gqlQuery(`query { image5k: findImages(filter:{per_page:0}) { count } }`);
        result.imageCount5k = (r.image5k && r.image5k.count) || 0;
      } catch(e) {}

      try {
        const ex3 = await gqlQuery(`query {
          watchedPlays: findScenes(scene_filter:{play_count:{value:0,modifier:GREATER_THAN}} filter:{per_page:-1}) {
            scenes { id play_count }
          }
        }`);
        ex3.watchedPlays.scenes.forEach(s => {
          if ((s.play_count||0) > result.maxPlayCount) {
            result.maxPlayCount = s.play_count;
            result.maxPlayCountSceneId = s.id;
          }
          // Fan Favorite: a scene rewatched 5+ times AND O'd 3+ times
          const oCount = sceneOCounterMap.get(s.id) || 0;
          if ((s.play_count||0) >= 5 && oCount >= 3) {
            result.fanFavoriteCount = (result.fanFavoriteCount||0) + 1;
            if (!result.fanFavoriteRef) result.fanFavoriteRef = { sceneId: s.id };
          }
        });
      } catch(e) {}
    }

    // Step 4: Tag achievements (each tag looked up individually to be resilient)
    let anyTagFound = false;
    for (let i = 0; i < TAG_ACHIEVEMENTS.length; i++) {
      try {
        const cfg = TAG_ACHIEVEMENTS[i];
        const tl = await gqlQuery(`query { findTags(tag_filter:{name:{value:${JSON.stringify(cfg.tagName)},modifier:INCLUDES}} filter:{per_page:-1}) { tags { id name } } }`);
        const tags = tl.findTags.tags;
        if (tags.length > 0) {
          const ids = tags.map(t => JSON.stringify(t.id)).join(",");
          const tc = await gqlQuery(`query { findScenes(scene_filter:{o_counter:{value:0,modifier:GREATER_THAN},tags:{value:[${ids}],modifier:INCLUDES}} filter:{per_page:0}) { count } }`);
          result.tagCounts[cfg.id] = tc.findScenes.count || 0;
          anyTagFound = true;
        } else {
          result.tagCounts[cfg.id] = 0;
        }
      } catch(e) { result.tagCounts[TAG_ACHIEVEMENTS[i].id] = 0; }
    }
    result.hasTagAchievements = anyTagFound;

    // Step 4b: Performer completion & devotion — how much of each performer's total
    // scene catalog has been O'd, and whether she's been O'd more times than she
    // has scenes (i.e. rewatched). Needs one lightweight pass over ALL scenes
    // (not just O'd ones) with just performer ids and o_counter.
    try {
      const pc = await gqlQuery(`query {
        findScenes(filter:{per_page:-1}) {
          scenes { id o_counter performers { id name image_path } }
        }
      }`);
      const totalSceneCounts = new Map(); // performerId -> total scenes she appears in
      const oSceneCounts     = new Map(); // performerId -> distinct O'd scenes
      const oSumCounts       = new Map(); // performerId -> sum of o_counter across her scenes
      const perfMeta         = new Map(); // performerId -> { name, image_path }
      (pc.findScenes.scenes||[]).forEach(s => {
        (s.performers||[]).forEach(p => {
          if (!perfMeta.has(p.id)) perfMeta.set(p.id, { name:p.name||"Unknown", image_path:p.image_path||null });
          totalSceneCounts.set(p.id, (totalSceneCounts.get(p.id)||0)+1);
          if ((s.o_counter||0) > 0) {
            oSceneCounts.set(p.id, (oSceneCounts.get(p.id)||0)+1);
            oSumCounts.set(p.id, (oSumCounts.get(p.id)||0)+(s.o_counter||0));
          }
        });
      });
      const completions = [];
      totalSceneCounts.forEach((total, pid) => {
        if (total < 3) return; // ignore performers with only 1-2 scenes — 100% is trivial
        const meta = perfMeta.get(pid) || {};
        const od = oSceneCounts.get(pid) || 0;
        completions.push({ performerId:pid, performerName:meta.name||"Unknown", image_path:meta.image_path||null, totalScenes:total, oScenes:od, pct: Math.round((od/total)*100) });
      });
      result.performerCompletions = completions;

      const devotees = [];
      oSumCounts.forEach((sum, pid) => {
        const total = totalSceneCounts.get(pid) || 0;
        if (total > 0 && sum > total) {
          const meta = perfMeta.get(pid) || {};
          devotees.push({ performerId:pid, performerName:meta.name||"Unknown", image_path:meta.image_path||null, oSum:sum, totalScenes:total, ratio: sum/total });
        }
      });
      devotees.sort((a,b) => b.ratio - a.ratio);
      result.performerDevotees = devotees;
    } catch(e) { result.performerCompletions = []; result.performerDevotees = []; }

    // Step 5b: Library longevity & monthly activity (across ALL scenes, not just O'd ones)
    try {
      const lib = await gqlQuery(`query {
        findScenes(filter:{per_page:-1, sort:"created_at", direction:ASC}) {
          scenes { id created_at }
        }
      }`);
      const validScenes = (lib.findScenes.scenes||[]).filter(s=>!isNaN(new Date(s.created_at).getTime()));
      const created = validScenes.map(s=>new Date(s.created_at));
      if (created.length) {
        const oldest = created.reduce((a,b)=> a<b?a:b);
        result.libraryAgeDays = Math.floor((Date.now() - oldest.getTime()) / 86400000);
        const monthSet = new Set(created.map(d => `${d.getFullYear()}-${d.getMonth()}`));
        result.activeMonthCount = monthSet.size;
      }
      // validScenes is already sorted ascending by created_at, so index N-1 is the Nth scene added
      result.sceneMilestones = {
        1:    validScenes[0]    ? validScenes[0].id    : null,
        100:  validScenes[99]   ? validScenes[99].id   : null,
        1000: validScenes[999]  ? validScenes[999].id  : null,
        5000: validScenes[4999] ? validScenes[4999].id : null,
      };

      // Biggest single-day / single-month library growth bursts (bulk imports).
      const dayScenesMap = new Map();
      const monthScenesMap = new Map();
      validScenes.forEach(s => {
        const d = new Date(s.created_at);
        const dk = dateKey(d);
        if (!dayScenesMap.has(dk)) dayScenesMap.set(dk, []);
        dayScenesMap.get(dk).push(s.id);
        const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
        if (!monthScenesMap.has(mk)) monthScenesMap.set(mk, []);
        monthScenesMap.get(mk).push(s.id);
      });
      let maxDayKey = null, maxDayCount = 0;
      dayScenesMap.forEach((arr,k) => { if (arr.length > maxDayCount) { maxDayCount = arr.length; maxDayKey = k; } });
      let maxMonthKey = null, maxMonthCount = 0;
      monthScenesMap.forEach((arr,k) => { if (arr.length > maxMonthCount) { maxMonthCount = arr.length; maxMonthKey = k; } });
      result.maxScenesInDay     = maxDayCount;
      result.maxScenesInDayInfo = maxDayKey ? { date:maxDayKey, sceneIds:dayScenesMap.get(maxDayKey) } : null;
      result.maxScenesInMonth     = maxMonthCount;
      result.maxScenesInMonthInfo = maxMonthKey ? { date:maxMonthKey, sceneIds:monthScenesMap.get(maxMonthKey) } : null;
    } catch(e) {}

    try {
      const perfMs = await gqlQuery(`query {
        findPerformers(filter:{per_page:500, sort:"created_at", direction:ASC}) {
          performers { id name }
        }
      }`);
      const plist = perfMs.findPerformers.performers || [];
      result.performerMilestones = {
        10:  plist[9]   || null,
        100: plist[99]  || null,
        250: plist[249] || null,
        500: plist[499] || null,
      };
    } catch(e) { result.performerMilestones = {}; }

    try {
      const wp = await gqlQuery(`query {
        findScenes(scene_filter:{play_count:{value:0,modifier:GREATER_THAN}} filter:{per_page:-1, sort:"last_played_at", direction:ASC}) {
          scenes { id }
        }
      }`);
      const wlist = wp.findScenes.scenes || [];
      result.watchedSceneMilestones = {
        1:   wlist[0]   ? wlist[0].id   : null,
        100: wlist[99]  ? wlist[99].id  : null,
        500: wlist[499] ? wlist[499].id : null,
      };
    } catch(e) { result.watchedSceneMilestones = {}; }

    // Step 5: Upcoming birthday across ALL performers (only needed if nobody's
    // birthday is today).
    if (!result.birthdayInfo) {
      try {
        const today = getRomeToday();
        const todayMs = Date.UTC(today.year, today.month, today.day);
        let cursor = 0;
        const perPage = 1000;
        let upcomingBirthday = null;
        while (true) {
          const pg = await gqlQuery(`query($page: Int!, $perPage: Int!) {
            findPerformers(filter:{per_page:$perPage, page:$page}) {
              count
              performers { id name birthdate }
            }
          }`, { page: cursor+1, perPage });
          const list = pg.findPerformers.performers || [];
          for (const p of list) {
            if (!p.birthdate) continue;
            const bd = new Date(p.birthdate);
            if (isNaN(bd.getTime())) continue;
            let candidate = Date.UTC(today.year, bd.getMonth(), bd.getDate());
            if (candidate < todayMs) candidate = Date.UTC(today.year+1, bd.getMonth(), bd.getDate());
            const daysUntil = Math.round((candidate - todayMs) / 86400000);
            if (!upcomingBirthday || daysUntil < upcomingBirthday.daysUntil) {
              upcomingBirthday = { performerId:p.id, performerName:p.name||"Unknown", daysUntil, month:bd.getMonth(), day:bd.getDate() };
            }
          }
          cursor++;
          if (list.length < perPage || cursor*perPage >= pg.findPerformers.count) break;
        }
        result.upcomingBirthday = upcomingBirthday;
      } catch(e) { result.upcomingBirthday = null; }
    }

    return result;
  }

  // ── O rating achievements (data comes from the stashOratings plugin) ─────
  async function loadORatingStats() {
    if (!window.stashORatings) return null;
    try {
      const [ratings, comments, scenes] = await Promise.all([window.stashORatings.getAll(), window.stashORatings.getComments(), fetchOScenesForRanking()]);
      const all = [];
      scenes.forEach(sc => {
        (sc.o_history || []).map(ts => new Date(ts).getTime()).filter(t => !isNaN(t)).forEach(t => {
          const k = `${sc.id}|${t}`;
          all.push({
            id: sc.id, t, title: sc.title || "(Untitled scene)",
            screenshot: (sc.paths && sc.paths.screenshot) || null,
            performerNames: (sc.performers || []).map(p => p.name).filter(Boolean),
            rating100: ratings[k] == null ? null : ratings[k],
            hasComment: !!comments[k],
            diffDaysLabel: dateKey(new Date(t)),
          });
        });
      });
      all.sort((x, y) => x.t - y.t);
      const rated = all.filter(i => i.rating100 != null);
      return { total: all.length, rated, unrated: all.length - rated.length, commented: all.filter(i => i.hasComment) };
    } catch (e) { return null; }
  }

  function getORatingAchievements(d) {
    const o = d.oRatings;
    if (!o) return [];
    const uniq = list => { const seen = new Set(); return list.filter(i => !seen.has(i.id) && seen.add(i.id)); };
    const mk = (id, icon, name, desc, current, target, tier, list) =>
      ({ id, category:"O Ratings", icon, name, description:desc, current, target, tier, sceneList: list && list.length ? uniq(list) : undefined });

    const tens  = o.rated.filter(i => i.rating100 === 100);
    const harsh = o.rated.filter(i => i.rating100 <= 30);
    const loved = o.rated.filter(i => i.rating100 >= 90);

    // Best run of consecutive rated O's (chronological) that are all 8/10 or higher.
    let cur = [], best = [];
    o.rated.forEach(i => { if (i.rating100 >= 80) { cur.push(i); if (cur.length > best.length) best = cur.slice(); } else cur = []; });

    // Scenes whose latest rated O differs from their first rated O by 2+ points.
    const byScene = new Map();
    o.rated.forEach(i => { if (!byScene.has(i.id)) byScene.set(i.id, []); byScene.get(i.id).push(i); });
    const grows = [], fades = [];
    byScene.forEach(arr => {
      if (arr.length < 2) return;
      const diff = arr[arr.length - 1].rating100 - arr[0].rating100;
      if (diff >= 20)  grows.push(arr[arr.length - 1]);
      if (diff <= -20) fades.push(arr[arr.length - 1]);
    });

    return [
      mk("orate-1",     "🗳️", "First Vote",       "Rate your first O.",                                         o.rated.length, 1,   "easy"),
      mk("orate-25",    "⚖️", "Judge",            "Rate 25 O's.",                                               o.rated.length, 25,  "medium"),
      mk("orate-100",   "🏛️", "Supreme Court",    "Rate 100 O's.",                                              o.rated.length, 100, "hard"),
      mk("orate-10-1",  "🔟", "Perfect Ten",      "Give an O a perfect 10/10.",                                 tens.length, 1,  "easy",   tens),
      mk("orate-10-10", "💯", "Ten Out of Ten",   "Give 10 O's a perfect 10/10.",                               tens.length, 10, "medium", tens),
      mk("orate-10-50", "🥇", "Gold Standard",    "Give 50 O's a perfect 10/10.",                               tens.length, 50, "hard",   tens),
      mk("orate-harsh", "🥶", "Tough Crowd",      "Give an O a rating of 3/10 or lower.",                       harsh.length, 1, "medium", harsh),
      mk("orate-range", "🎢", "Full Range",       "Rate one O 3/10 or lower and another 9/10 or higher.",       (harsh.length && loved.length) ? 1 : 0, 1, "medium"),
      mk("orate-streak","🔥", "Hot Streak",       "Rate 10 O's in a row 8/10 or higher.",                       best.length, 10, "hard",   best),
      mk("orate-grows", "📈", "Grows on You",     "Rate a scene's later O 2+ points higher than its first.",    grows.length ? 1 : 0, 1, "medium", grows),
      mk("orate-fades", "📉", "Lost the Spark",   "Rate a scene's later O 2+ points lower than its first.",     fades.length ? 1 : 0, 1, "medium", fades),
      mk("orate-cmt-10","💬", "Wordsmith",        "Write comments on 10 O's.",                                  o.commented.length, 10, "medium"),
      mk("orate-cmt-50","📓", "Diarist",          "Write comments on 50 O's.",                                  o.commented.length, 50, "hard"),
      mk("orate-all",   "✅", "Fully Scored",     "Have every logged O rated.",                                 (o.total > 0 && o.unrated === 0) ? 1 : 0, 1, "hard"),
    ];
  }

  // ── Achievement definitions ───────────────────────────────────────────────
  function getAchievements(d) {
    const t = d.timing || {};
    const tr = d.timingRefs || {};
    const tc = d.timingCounts || {};
    const a = [];

    // helper
    const add = (obj) => a.push(obj);
    const sceneRef = (key) => (tr[key] && tr[key].sceneId) ? tr[key].sceneId : null;

    // SCENES
    add({ id:"first-scene",   category:"Scenes", icon:"🎬", name:"First Frame",      description:"Add your first scene.",                                     current:d.stats.scene_count, target:1,    tier:"easy",   sceneId:d.sceneMilestones?d.sceneMilestones[1]:null });
    add({ id:"scene-100",     category:"Scenes", icon:"📼", name:"Growing Library",   description:"Reach 100 scenes.",                                         current:d.stats.scene_count, target:100,  tier:"medium", sceneId:d.sceneMilestones?d.sceneMilestones[100]:null });
    add({ id:"scene-1000",    category:"Scenes", icon:"🏛️", name:"Mega Archive",      description:"Reach 1,000 scenes.",                                       current:d.stats.scene_count, target:1000, tier:"hard",   sceneId:d.sceneMilestones?d.sceneMilestones[1000]:null });
    add({ id:"scene-5000",    category:"Scenes", icon:"🌌", name:"The Vault",         description:"Reach 5,000 scenes. A beautiful problem.",                  current:d.stats.scene_count, target:5000, tier:"hard",   sceneId:d.sceneMilestones?d.sceneMilestones[5000]:null });
    if (d.hasODetail) {
      add({ id:"ensemble-o",      category:"Scenes", icon:"🎭", name:"Ensemble Cast",     description:"O on a scene with 5+ performers.",                          current:d.ensembleORef?1:0, target:1, tier:"medium", total:d.ensembleOCount||0, sceneId:d.ensembleORef?d.ensembleORef.sceneId:null });
      add({ id:"instant-classic", category:"Scenes", icon:"🏅", name:"Instant Classic",   description:"O 3+ times on a perfect-rated (10/10) scene.",              current:d.instantClassicRef?1:0, target:1, tier:"hard", total:d.instantClassicCount||0, sceneId:d.instantClassicRef?d.instantClassicRef.sceneId:null });
      add({ id:"guilty-pleasure", category:"Scenes", icon:"🙈", name:"Guilty Pleasure",   description:"O 3+ times on a scene rated below 5/10. No judgement.",      current:d.guiltyPleasureRef?1:0, target:1, tier:"medium", total:d.guiltyPleasureCount||0, sceneId:d.guiltyPleasureRef?d.guiltyPleasureRef.sceneId:null });
      add({ id:"short-sweet",     category:"Scenes", icon:"✨", name:"Short and Sweet",   description:"O on a perfect-rated scene under 10 minutes long.",         current:d.shortAndSweetRef?1:0, target:1, tier:"medium", total:d.shortAndSweetCount||0, sceneId:d.shortAndSweetRef?d.shortAndSweetRef.sceneId:null });
      add({ id:"fan-favorite",    category:"Scenes", icon:"🌟", name:"Fan Favorite Scene",description:"A single scene rewatched 5+ times and O'd 3+ times.",       current:d.fanFavoriteRef?1:0, target:1, tier:"hard", total:d.fanFavoriteCount||0, sceneId:d.fanFavoriteRef?d.fanFavoriteRef.sceneId:null });
    }

    // PERFORMERS
    add({ id:"performer-10",  category:"Performers", icon:"👋", name:"Meet & Greet",           description:"Catalog 10 performers.",                           current:d.stats.performer_count, target:10,  tier:"easy",   performerPopup:true, performerId:d.performerMilestones&&d.performerMilestones[10] ?d.performerMilestones[10].id :null, performerName:d.performerMilestones&&d.performerMilestones[10] ?d.performerMilestones[10].name :null });
    add({ id:"performer-100", category:"Performers", icon:"🌟", name:"Star Tracker",            description:"Catalog 100 performers.",                          current:d.stats.performer_count, target:100, tier:"medium", performerPopup:true, performerId:d.performerMilestones&&d.performerMilestones[100]?d.performerMilestones[100].id:null, performerName:d.performerMilestones&&d.performerMilestones[100]?d.performerMilestones[100].name:null });
    add({ id:"performer-250", category:"Performers", icon:"📖", name:"Performer Encyclopedia",  description:"Catalog 250 performers.",                          current:d.stats.performer_count, target:250, tier:"hard",   performerPopup:true, performerId:d.performerMilestones&&d.performerMilestones[250]?d.performerMilestones[250].id:null, performerName:d.performerMilestones&&d.performerMilestones[250]?d.performerMilestones[250].name:null });
    add({ id:"performer-500", category:"Performers", icon:"🗂️", name:"The Casting Director",    description:"Catalog 500 performers.",                          current:d.stats.performer_count, target:500, tier:"hard",   performerPopup:true, performerId:d.performerMilestones&&d.performerMilestones[500]?d.performerMilestones[500].id:null, performerName:d.performerMilestones&&d.performerMilestones[500]?d.performerMilestones[500].name:null });
    add({ id:"mature-5",      category:"Performers", icon:"🍷", name:"Distinguished Taste",     description:"O on scenes with 5 different performers aged 50+.",current:d.maturePerformerCount, target:5,   tier:"medium" });
    add({ id:"mature-15",     category:"Performers", icon:"🥂", name:"Silver Fox Devotee",      description:"O on scenes with 15 different performers aged 50+.",current:d.maturePerformerCount,target:15,  tier:"hard"   });
    add({ id:"mature-30",     category:"Performers", icon:"🍸", name:"Fine Wine Collector",     description:"O on scenes with 30 different performers aged 50+.",current:d.maturePerformerCount,target:30,  tier:"hard"   });
    add({ id:"fav-5",         category:"Performers", icon:"❤️", name:"Fan Favorite",            description:"Mark 5 performers as favorites.",                  current:d.favoritePerformers,   target:5,   tier:"easy"   });
    add({ id:"fav-25",        category:"Performers", icon:"💞", name:"Superfan",                description:"Mark 25 performers as favorites.",                 current:d.favoritePerformers,   target:25,  tier:"hard"   });
    if (d.hasODetail) {
      add({ id:"spring-chicken",     category:"Performers", icon:"🐣", name:"Spring Chicken",      description:"O on a performer aged 25 or younger.",              current:d.youngestOAge!==null&&d.youngestOAge<=25?1:0, target:1,  tier:"easy",   performerPopup:true, performerId:d.youngestOInfo?d.youngestOInfo.performerId:null, performerName:d.youngestOInfo?d.youngestOInfo.performerName:null });
      add({ id:"golden-years",       category:"Performers", icon:"🌇", name:"Golden Years",        description:"O on a performer aged 60+.",                         current:d.oldestOAge!==null&&d.oldestOAge>=60?1:0,    target:1,  tier:"medium", performerPopup:true, performerId:d.oldestOInfo?d.oldestOInfo.performerId:null, performerName:d.oldestOInfo?d.oldestOInfo.performerName:null });
      add({ id:"antique-collector",  category:"Performers", icon:"🏺", name:"Antique Collector",   description:"O on a performer aged 70+.",                         current:d.oldestOAge!==null&&d.oldestOAge>=70?1:0,    target:1,  tier:"hard",   performerPopup:true, performerId:d.oldestOInfo?d.oldestOInfo.performerId:null, performerName:d.oldestOInfo?d.oldestOInfo.performerName:null });
      add({ id:"generation-gap",     category:"Performers", icon:"🌉", name:"Generation Gap",      description:"O's on performers spanning 30+ years in age.",       current:d.oAgeRange,   target:30, tier:"medium" });
      add({ id:"time-machine",       category:"Performers", icon:"⏰", name:"Time Machine",        description:"O's on performers spanning 50+ years in age.",       current:d.oAgeRange,   target:50, tier:"hard"   });
      add({ id:"anthropologist",     category:"Performers", icon:"🧬", name:"Anthropologist",      description:"O's on performers spanning 40+ years in age.",       current:d.oAgeRange,   target:40, tier:"hard"   });
      add({ id:"tall-order",         category:"Performers", icon:"📏", name:"Tall Order",          description:"O on a performer taller than the median height in your library.",                  current:d.hasTallPerformer?1:0,  target:1, tier:"easy",   total:d.tallPerformerCount||0, performerPopup:true, performerId:d.tallestO?d.tallestO.performerId:null, performerName:d.tallestO?d.tallestO.performerName:null });
      add({ id:"pocket-rocket",      category:"Performers", icon:"🤏", name:"Pocket Rocket",       description:"O on a performer shorter than the median height in your library.",                 current:d.hasPetitePerformer?1:0,target:1, tier:"medium", total:d.petitePerformerCount||0, performerPopup:true, performerId:d.shortestO?d.shortestO.performerId:null, performerName:d.shortestO?d.shortestO.performerName:null });
      add({ id:"body-art",           category:"Performers", icon:"🎨", name:"Body Art Appreciation",description:"O on a performer with tattoos or piercings.",       current:d.hasBodyArt?1:0,        target:1, tier:"easy",   total:d.bodyArtPerformerCount||0, performerPopup:true, performerId:d.bodyArtInfo?d.bodyArtInfo.performerId:null, performerName:d.bodyArtInfo?d.bodyArtInfo.performerName:null });
      add({ id:"open-minded",        category:"Performers", icon:"🏳️‍🌈",name:"Open Minded",        description:"O's on performers of 2+ different genders.",         current:d.oGenders.size,   target:2, tier:"medium" });
      add({ id:"p-streak-5",         category:"Performers", icon:"💕", name:"One True Love",       description:"O's on 5 different scenes with the same performer.", current:d.maxPerformerSceneCount, target:5,  tier:"medium", performerPopup:true, performerId:d.maxScenePerformerInfo?d.maxScenePerformerInfo.performerId:null, performerName:d.maxScenePerformerInfo?d.maxScenePerformerInfo.performerName:null });
      add({ id:"p-streak-15",        category:"Performers", icon:"💍", name:"Soulmate",            description:"O's on 15 different scenes with the same performer.",current:d.maxPerformerSceneCount, target:15, tier:"hard",   performerPopup:true, performerId:d.maxScenePerformerInfo?d.maxScenePerformerInfo.performerId:null, performerName:d.maxScenePerformerInfo?d.maxScenePerformerInfo.performerName:null });
      add({ id:"p-streak-30",        category:"Performers", icon:"💘", name:"Obsessive",           description:"O's on 30 different scenes with the same performer. Yikes.",current:d.maxPerformerSceneCount,target:30,tier:"hard", performerPopup:true, performerId:d.maxScenePerformerInfo?d.maxScenePerformerInfo.performerId:null, performerName:d.maxScenePerformerInfo?d.maxScenePerformerInfo.performerName:null });
      add({ id:"rookie-3",           category:"Performers", icon:"🌱", name:"Rookie Sensation",     description:"O 3 performers within 30 days of adding them to your library.", current:d.rookieCount||0, target:3,  tier:"medium", performerList:(d.rookiePerformersAll||[]).map(p=>({...p, note:`O'd ${p.days} day${p.days!==1?"s":""} after being added`})) });
      add({ id:"rookie-10",          category:"Performers", icon:"⚡", name:"Fast Track",           description:"O 10 performers within 30 days of adding them to your library.", current:d.rookieCount||0, target:10, tier:"hard",   performerList:(d.rookiePerformersAll||[]).map(p=>({...p, note:`O'd ${p.days} day${p.days!==1?"s":""} after being added`})) });
      add({ id:"veteran-1",          category:"Performers", icon:"🎖️", name:"Veteran Status",       description:"O a performer who waited 2+ years in your library for their first O.", current:d.veteranCount||0, target:1, tier:"medium", performerList:(d.veteranPerformersAll||[]).map(p=>({...p, note:`Waited ${p.days} days for her first O`})) });
      add({ id:"veteran-5",          category:"Performers", icon:"🏵️", name:"Old Guard",            description:"O 5 performers who each waited 2+ years in your library for their first O.", current:d.veteranCount||0, target:5, tier:"hard", performerList:(d.veteranPerformersAll||[]).map(p=>({...p, note:`Waited ${p.days} days for her first O`})) });
    }

    // VITAL STATS — combos of body metrics, time, duration & O's
    if (d.hasODetail) {
      if (d.hasWeight) {
        add({ id:"heavyweight",    category:"Vital Stats", icon:"🏋️", name:"Heavyweight Title",   description:"O on a performer in the heaviest 10% of your library. Respect.",  current:(d.heaviestO&&d.weightP90!=null&&d.heaviestO.weight>=d.weightP90)?1:0, target:1, tier:"medium", total:d.top10HeavyCount||0, sceneId:d.heaviestO?d.heaviestO.sceneId:null, performerId:d.heaviestO?d.heaviestO.performerId:null, performerName:d.heaviestO?d.heaviestO.performerName:null });
        add({ id:"featherweight",  category:"Vital Stats", icon:"🪶", name:"Featherweight Division", description:"O on a performer in the lightest 10% of your library.",          current:(d.lightestO&&d.weightP10!=null&&d.lightestO.weight<=d.weightP10)?1:0, target:1, tier:"easy", total:d.bottom10LightCount||0, sceneId:d.lightestO?d.lightestO.sceneId:null, performerId:d.lightestO?d.lightestO.performerId:null, performerName:d.lightestO?d.lightestO.performerName:null });
        add({ id:"weight-range",   category:"Vital Stats", icon:"⚖️", name:"Wide Spectrum",       description:"O's on performers spanning 40kg+ in body weight.",  current:(d.heaviestO&&d.lightestO)?(d.heaviestO.weight-d.lightestO.weight):0, target:40, tier:"hard" });
      }
      add({ id:"defying-gravity", category:"Vital Stats", icon:"🪂", name:"Defying Gravity",      description:"O on a performer in the tallest 10% of your library.",                       current:(d.tallestO&&d.heightP90!=null&&d.tallestO.height>=d.heightP90)?1:0, target:1, tier:"medium", total:d.top10TallCount||0, sceneId:d.tallestO?d.tallestO.sceneId:null, performerId:d.tallestO?d.tallestO.performerId:null, performerName:d.tallestO?d.tallestO.performerName:null });
      add({ id:"whole-package",  category:"Vital Stats", icon:"🎁", name:"The Whole Package",     description:"O on an above-median-height performer with both tattoos and piercings.", current:d.wholePackageInfo?1:0, target:1, tier:"hard", total:d.wholePackageCount||0, sceneId:d.wholePackageInfo?d.wholePackageInfo.sceneId:null, performerId:d.wholePackageInfo?d.wholePackageInfo.performerId:null, performerName:d.wholePackageInfo?d.wholePackageInfo.performerName:null });
      add({ id:"height-range",   category:"Vital Stats", icon:"📐", name:"From the Ground Up",   description:"O's on performers spanning 40cm+ in height.",         current:(d.tallestO&&d.shortestO)?(d.tallestO.height-d.shortestO.height):0, target:40, tier:"medium" });
      add({ id:"marathon",       category:"Stamina", icon:"🏃", name:"Marathon Session",      description:"3+ O's on a single scene that's 90+ minutes long. Stay hydrated.", current:d.marathonRef?1:0, target:1, tier:"hard", total:d.marathonCount||0, sceneId:d.marathonRef?d.marathonRef.sceneId:null });
      add({ id:"quickie",        category:"Stamina", icon:"⚡", name:"The Quickie",           description:"O on a scene under 5 minutes long. Efficient.",       current:d.quickieRef?1:0, target:1, tier:"easy", total:d.quickieCount||0, sceneId:d.quickieRef?d.quickieRef.sceneId:null });
      add({ id:"long-haul",      category:"Stamina", icon:"🌃", name:"The Long Haul",         description:"O between midnight and 5am on a scene 60+ minutes long.", current:d.longNightRef?1:0, target:1, tier:"hard", total:d.longNightCount||0, sceneId:d.longNightRef?d.longNightRef.sceneId:null });
      add({ id:"going-distance", category:"Stamina", icon:"🛋️", name:"Going the Distance",    description:"Rack up 5+ hours of cumulative watch time with O's on the same performer.", current:d.maxPerformerPlayMins?Math.round(d.maxPerformerPlayMins.mins/60*10)/10:0, target:5, tier:"hard", performerId:d.maxPerformerPlayMins?d.maxPerformerPlayMins.performerId:null, performerName:d.maxPerformerPlayMins?d.maxPerformerPlayMins.performerName:null });
      add({ id:"ultra-marathon", category:"Stamina", icon:"🏅", name:"Ultra Marathon",        description:"5+ O's on a single scene that's 120+ minutes long. Hydration is key.", current:d.ultraMarathonRef?1:0, target:1, tier:"hard", total:d.ultraMarathonCount||0, sceneId:d.ultraMarathonRef?d.ultraMarathonRef.sceneId:null });
      add({ id:"speed-run",      category:"Stamina", icon:"🏁", name:"Speed Run",             description:"O on a scene under 3 minutes long. Personal best.",    current:d.speedRunRef?1:0, target:1, tier:"medium", total:d.speedRunCount||0, sceneId:d.speedRunRef?d.speedRunRef.sceneId:null });
      add({ id:"giant",          category:"Vital Stats", icon:"🗼", name:"Giant",                 description:"O on the tallest performer in your library.",                        current:d.giantMatch?1:0, target:1, tier:"hard", total:d.recordTallCount||0, sceneId:d.giantMatch?d.giantMatch.sceneId:null, performerId:d.giantMatch?d.giantMatch.performerId:null, performerName:d.giantMatch?d.giantMatch.performerName:null });
      add({ id:"pocket-size",    category:"Vital Stats", icon:"🔍", name:"Pocket Size",           description:"O on the shortest performer in your library.",                        current:d.pocketSizeMatch?1:0, target:1, tier:"hard", total:d.recordShortCount||0, sceneId:d.pocketSizeMatch?d.pocketSizeMatch.sceneId:null, performerId:d.pocketSizeMatch?d.pocketSizeMatch.performerId:null, performerName:d.pocketSizeMatch?d.pocketSizeMatch.performerName:null });
      if (d.hasWeight) {
        add({ id:"bantamweight",     category:"Vital Stats", icon:"🪽", name:"Bantamweight",          description:"O on the lightest performer in your library.",       current:d.bantamweightMatch?1:0, target:1, tier:"hard", total:d.recordLightCount||0, sceneId:d.bantamweightMatch?d.bantamweightMatch.sceneId:null, performerId:d.bantamweightMatch?d.bantamweightMatch.performerId:null, performerName:d.bantamweightMatch?d.bantamweightMatch.performerName:null });
        add({ id:"super-heavyweight",category:"Vital Stats", icon:"🦣", name:"Super Heavyweight",     description:"O on the heaviest performer in your library.",    current:d.superHeavyweightMatch?1:0, target:1, tier:"hard", total:d.recordHeavyCount||0, sceneId:d.superHeavyweightMatch?d.superHeavyweightMatch.sceneId:null, performerId:d.superHeavyweightMatch?d.superHeavyweightMatch.performerId:null, performerName:d.superHeavyweightMatch?d.superHeavyweightMatch.performerName:null });
      }
      add({ id:"age-combo-100", category:"Vital Stats", icon:"🎂", name:"Age Combo",           description:"O on a scene where the two oldest performers have a combined age of 100+.", current:d.ageComboInfo?d.ageComboInfo.sum:0, target:100, tier:"medium", sceneId:d.ageComboInfo?d.ageComboInfo.sceneId:null });
      add({ id:"age-combo-140", category:"Vital Stats", icon:"🎉", name:"Century Club",         description:"O on a scene where the two oldest performers have a combined age of 140+.", current:d.ageComboInfo?d.ageComboInfo.sum:0, target:140, tier:"hard",   sceneId:d.ageComboInfo?d.ageComboInfo.sceneId:null });
      if (d.hasOHistory) {
        add({ id:"senior-siesta",  category:"Vital Stats", icon:"🧓", name:"Senior Discount",      description:"O during siesta hours (2-4pm) on a performer aged 60+.", current:d.seniorSiestaInfo?1:0, target:1, tier:"hard", total:d.seniorSiestaCount||0, sceneId:d.seniorSiestaInfo?d.seniorSiestaInfo.sceneId:null });
        add({ id:"midlife-crisis", category:"Vital Stats", icon:"🏎️", name:"Midlife Crisis",       description:"O between midnight and 5am with a performer aged 40-50.", current:d.midlifeNightInfo?1:0, target:1, tier:"hard", total:d.midlifeNightCount||0, sceneId:d.midlifeNightInfo?d.midlifeNightInfo.sceneId:null });
      }
    }

    // STUDIOS & TAGS
    add({ id:"studio-25",   category:"Studios & Tags", icon:"🏢", name:"Studio Scout",    description:"Catalog 25 studios.",  current:d.stats.studio_count, target:25,  tier:"medium" });
    add({ id:"studio-100",  category:"Studios & Tags", icon:"🌆", name:"Industry Insider", description:"Catalog 100 studios.", current:d.stats.studio_count, target:100, tier:"hard"   });
    add({ id:"tag-50",      category:"Studios & Tags", icon:"🏷️", name:"Tag Team",         description:"Create 50 tags.",      current:d.stats.tag_count,    target:50,  tier:"medium" });
    add({ id:"tag-200",     category:"Studios & Tags", icon:"🗃️", name:"Tag Maniac",        description:"Create 200 tags.",     current:d.stats.tag_count,    target:200, tier:"hard"   });
    if (d.hasODetail) {
      add({ id:"s-streak-10", category:"Studios & Tags", icon:"🎟️", name:"Loyal Customer", description:"Log 10+ total O's on scenes from the same studio.", current:d.maxStudioOSum||0, target:10, tier:"medium" });
      add({ id:"s-streak-25", category:"Studios & Tags", icon:"🥇", name:"Studio Superfan", description:"Log 25+ total O's on scenes from the same studio.", current:d.maxStudioOSum||0, target:25, tier:"hard"   });
      add({ id:"s-streak-50", category:"Studios & Tags", icon:"🏆", name:"Brand Loyalty",   description:"Log 50+ total O's on scenes from the same studio.", current:d.maxStudioOSum||0, target:50, tier:"hard"   });
    }

    // RATINGS
    add({ id:"rated-25",   category:"Ratings", icon:"✍️", name:"Critic",             description:"Rate 25 scenes.",    current:d.rated,      target:25,   tier:"easy"   });
    add({ id:"rated-250",  category:"Ratings", icon:"🎙️", name:"Top Critic",         description:"Rate 250 scenes.",   current:d.rated,      target:250,  tier:"hard"   });
    add({ id:"rated-1000", category:"Ratings", icon:"📝", name:"Ebert Would Be Proud",description:"Rate 1,000 scenes.",current:d.rated,      target:1000, tier:"hard"   });
    add({ id:"five-25",    category:"Ratings", icon:"⭐", name:"Perfectionist",       description:"Give 25 scenes a perfect rating.",    current:d.fiveStar,         target:25, tier:"medium" });
    add({ id:"five-perfs", category:"Ratings", icon:"🌠", name:"Hall of Fame",        description:"Give 10 performers a perfect rating.",current:d.fiveStarPerformers,target:10,tier:"medium" });

    // ORGANIZATION
    add({ id:"organized-100", category:"Organization", icon:"🗂️", name:"Tidy Up",        description:"Mark 100 scenes as organized.", current:d.organized,    target:100, tier:"medium" });
    add({ id:"tagged-100",    category:"Organization", icon:"🔖", name:"Taxonomy Nerd",   description:"Tag 100 scenes.",              current:d.taggedScenes, target:100, tier:"medium" });
    add({ id:"tagged-500",    category:"Organization", icon:"📚", name:"Dewey Decimal",   description:"Tag 500 scenes.",              current:d.taggedScenes, target:500, tier:"hard"   });
    add({ id:"zero-unrated",  category:"Organization", icon:"✅", name:"Zero Unrated",    description:"Rate every scene — zero unrated remaining.", current:d.unratedScenes===0&&d.stats.scene_count>0?1:0,target:1,tier:"hard"});
    add({ id:"mystery-meat",  category:"Organization", icon:"🕵️", name:"Mystery Meat",    description:"Have at least 1 scene with no studio. Clean it up!", current:d.noStudioScenes>0?1:0,target:1,tier:"easy"});

    // LIBRARY
    if (d.hasExtra) {
      add({ id:"image-1000",  category:"Library", icon:"🖼️", name:"Picture Perfect", description:"Reach 1,000 images.",            current:d.imageCount,   target:1000, tier:"medium" });
      add({ id:"image-5000",  category:"Library", icon:"🗄️", name:"Photo Hoarder",   description:"Reach 5,000 images.",            current:d.imageCount5k, target:5000, tier:"hard"   });
      add({ id:"gallery-25",  category:"Library", icon:"🖼️", name:"Gallery Curator", description:"Catalog 25 galleries.",          current:d.galleryCount, target:25,   tier:"medium" });
      add({ id:"gallery-100", category:"Library", icon:"🏛️", name:"The Louvre",      description:"Catalog 100 galleries.",         current:d.galleryCount, target:100,  tier:"hard"   });
      add({ id:"dur-24h",     category:"Library", icon:"⏳", name:"Binge Ready",     description:"Reach 24h of total runtime.",    current:d.scenesDuration, target:86400,   tier:"medium", format:"hours" });
      add({ id:"dur-7d",      category:"Library", icon:"🗓️", name:"A Whole Week",    description:"Reach 7 days of total runtime.", current:d.scenesDuration, target:604800, tier:"hard",   format:"hours" });
    }

    // PLAYBACK
    add({ id:"watched-1",   category:"Playback", icon:"▶️", name:"First Watch",    description:"Watch your first scene.",                  current:d.watchedScenes, target:1,   tier:"easy",   sceneId:d.watchedSceneMilestones?d.watchedSceneMilestones[1]:null });
    add({ id:"watched-100", category:"Playback", icon:"📺", name:"Couch Potato",   description:"Watch 100 scenes.",                        current:d.watchedScenes, target:100, tier:"medium", sceneId:d.watchedSceneMilestones?d.watchedSceneMilestones[100]:null });
    add({ id:"watched-500", category:"Playback", icon:"🎞️", name:"Home Cinema",    description:"Watch 500 scenes.",                        current:d.watchedScenes, target:500, tier:"hard",   sceneId:d.watchedSceneMilestones?d.watchedSceneMilestones[500]:null });
    add({ id:"rewatch-10",  category:"Playback", icon:"🔁", name:"Repeat Viewer",  description:"Watch one scene 10 times.",                current:d.maxPlayCount,  target:10,  tier:"hard", sceneId:d.maxPlayCount>=10?d.maxPlayCountSceneId:null });
    add({ id:"rewatch-25",  category:"Playback", icon:"🔂", name:"Obsessed",       description:"Watch one scene 25 times. We don't judge.",current:d.maxPlayCount,  target:25,  tier:"hard", sceneId:d.maxPlayCount>=25?d.maxPlayCountSceneId:null });
    if (d.hasExtra) {
      add({ id:"group-scenes-50", category:"Playback", icon:"👥", name:"More the Merrier",  description:"Have 50 scenes with 3+ performers.",   current:d.groupScenes, target:50,  tier:"medium" });
      add({ id:"solo-scenes-25",  category:"Playback", icon:"🕴️", name:"Solo Exhibition",   description:"Have 25 scenes with 1 performer.",     current:d.soloScenes,  target:25,  tier:"easy"   });
    }

    // O COUNTER
    add({ id:"o-scenes-10",  category:"O Counter", icon:"💯", name:"Hit the Mark",       description:"Log an O on 10 scenes.",   current:d.oScenes,      target:10,   tier:"easy",   sceneId:d.oSceneMilestones?d.oSceneMilestones[10]:null });
    add({ id:"o-scenes-50",  category:"O Counter", icon:"🧮", name:"Quantity Over Quality",description:"Log an O on 50 scenes.", current:d.oScenes,      target:50,   tier:"medium", sceneId:d.oSceneMilestones?d.oSceneMilestones[50]:null });
    add({ id:"o-scenes-100", category:"O Counter", icon:"💯", name:"The Centurion",       description:"Log an O on 100 distinct scenes (as opposed to On Fire, which counts total O logs).", current:d.oScenes, target:100,  tier:"hard", sceneId:d.oSceneMilestones?d.oSceneMilestones[100]:null });
    add({ id:"o-sum-100",    category:"O Counter", icon:"🔥", name:"On Fire",             description:"Reach 100 total O-counts.",current:d.oCounterSum, target:100,  tier:"medium", sceneList:d.oCounterTopScenes||[] });
    add({ id:"o-sum-500",    category:"O Counter", icon:"💎", name:"Legendary",           description:"Reach 500 total O-counts.",current:d.oCounterSum, target:500,  tier:"hard",   sceneList:d.oCounterTopScenes||[] });
    add({ id:"o-sum-1000",   category:"O Counter", icon:"👑", name:"The Emperor",         description:"Reach 1,000 total O-counts. Absolute royalty.", current:d.oCounterSum, target:1000, tier:"hard", sceneList:d.oCounterTopScenes||[] });
    add({ id:"single-3",     category:"O Counter", icon:"🎪", name:"Hat Trick",   description:"Reach 3 O's on a single scene.",               current:d.maxSceneOCount, target:3,  tier:"easy", sceneId:d.maxSceneOCount>=3?d.maxSceneOCountSceneId:null });
    add({ id:"single-5",     category:"O Counter", icon:"🎯", name:"Personal Best",description:"Reach 5 O's on a single scene.",              current:d.maxSceneOCount, target:5,  tier:"medium", sceneId:d.maxSceneOCount>=5?d.maxSceneOCountSceneId:null });
    add({ id:"single-15",    category:"O Counter", icon:"🚀", name:"Unstoppable", description:"Reach 15 O's on a single scene.",              current:d.maxSceneOCount, target:15, tier:"hard", sceneId:d.maxSceneOCount>=15?d.maxSceneOCountSceneId:null });

    if (d.hasOHistory) {
      add({ id:"night-owl",    category:"O Counter", icon:"🌙", name:"Night Owl",     description:"Log an O between midnight and 5am.",  current:t.nightOwl?1:0,     target:1, total:tc.nightOwl||0, tier:"medium", sceneId:sceneRef("nightOwl") });
      add({ id:"early-bird",   category:"O Counter", icon:"🌅", name:"Early Bird",    description:"Log an O between 5am and 8am.",      current:t.earlyBird?1:0,    target:1, total:tc.earlyBird||0, tier:"medium", sceneId:sceneRef("earlyBird") });
      add({ id:"lunch-break",  category:"O Counter", icon:"🥪", name:"Lunch Break",   description:"Log an O between noon and 1pm.",     current:t.lunchBreak?1:0,   target:1, total:tc.lunchBreak||0, tier:"easy", sceneId:sceneRef("lunchBreak") });
      add({ id:"witching-hour",category:"O Counter", icon:"🔮", name:"Witching Hour", description:"Log an O between 3am and 4am.",      current:t.witchingHour?1:0, target:1, total:tc.witchingHour||0, tier:"hard"   });
      add({ id:"o-days-5",     category:"O Counter", icon:"📅", name:"Dedicated",     description:"Log an O on 5 different days.",      current:d.oDistinctDays,    target:5,  tier:"medium" });
      add({ id:"o-days-30",    category:"O Counter", icon:"🗺️", name:"Frequent Flyer",description:"Log an O on 30 different days.",     current:d.oDistinctDays,    target:30, tier:"hard"   });
      add({ id:"o-streak-3",   category:"O Counter", icon:"🔗", name:"On a Roll",     description:"Log an O on 3 consecutive days.",    current:d.oLongestStreak,   target:3,  tier:"hard"   });
      add({ id:"o-streak-7",   category:"O Counter", icon:"📆", name:"Week Warrior",  description:"Log an O on 7 consecutive days.",    current:d.oLongestStreak,   target:7,  tier:"hard"   });
    }

    // VARIETY
    if (d.hasODetail) {
      const oLetters = d.oLetters || new Set();
      const missing  = ALPHABET.filter(l => !oLetters.has(l));
      const azDesc   = missing.length ? `Cover all 26 starting letters. Missing: ${missing.join(", ")}.` : "All 26 letters covered!";
      add({ id:"alpha-half",  category:"Variety", icon:"🔤", name:"Halfway Through the Alphabet", description:"O's covering 13 different starting letters.", current:oLetters.size, target:13, tier:"medium" });
      add({ id:"alpha-all",   category:"Variety", icon:"🔠", name:"A to Z",                       description:azDesc,                                        current:oLetters.size, target:26, tier:"hard"   });
      add({ id:"world-5",     category:"Variety", icon:"🌍", name:"World Tour",                   description:"O's on performers from 5 different countries.",current:d.oCountries.size, target:5,  tier:"medium" });
      add({ id:"world-10",    category:"Variety", icon:"🌐", name:"Globe Trotter",                description:"O's on performers from 10 countries.",         current:d.oCountries.size, target:10, tier:"hard"   });
      add({ id:"world-20",    category:"Variety", icon:"🛩️", name:"Diplomat",                    description:"O's on performers from 20 countries.",         current:d.oCountries.size, target:20, tier:"hard"   });
      add({ id:"decades-4",   category:"Variety", icon:"📻", name:"Decades of Devotion",          description:"O's on performers born in 4 different decades.",current:d.oDecades.size, target:4, tier:"medium" });
      add({ id:"decades-6",   category:"Variety", icon:"🛸", name:"Time Traveler",                description:"O's on performers born in 6 different decades.",current:d.oDecades.size, target:6, tier:"hard"   });
      add({ id:"hair-4",      category:"Variety", icon:"🌈", name:"Rainbow Collection",           description:"O's on performers with 4 different hair colors.",current:d.oHairColors.size,target:4,tier:"medium" });
      add({ id:"hair-6",      category:"Variety", icon:"💈", name:"Hair Architect",               description:"O's on performers with 6 different hair colors.",current:d.oHairColors.size,target:6,tier:"hard"  });
      add({ id:"eyes-4",      category:"Variety", icon:"👁️", name:"Spectrum Seeker",              description:"O's on performers with 4 different eye colors.", current:d.oEyeColors.size, target:4, tier:"medium" });
      add({ id:"eyes-6",      category:"Variety", icon:"🔮", name:"Kaleidoscope Eyes",            description:"O's on performers with 6 different eye colors.", current:d.oEyeColors.size, target:6, tier:"hard" });
      add({ id:"melting-pot", category:"Variety", icon:"🧩", name:"Melting Pot",                  description:"O's on performers of 3 different ethnicities.", current:d.oEthnicities.size,target:3, tier:"medium" });
      add({ id:"cultural-mosaic", category:"Variety", icon:"🗺️", name:"Cultural Mosaic",          description:"O's on performers of 5 different ethnicities.", current:d.oEthnicities.size,target:5, tier:"hard" });
      add({ id:"full-spectrum", category:"Variety", icon:"🏳️‍🌈", name:"Full Spectrum",           description:"O's on performers of 4 different genders.",     current:d.oGenders.size,     target:4, tier:"hard" });
      add({ id:"decades-8",   category:"Variety", icon:"🕰️", name:"Living History",               description:"O's on performers born in 8 different decades.", current:d.oDecades.size,  target:8, tier:"hard"   });
      add({ id:"studio-variety-10", category:"Variety", icon:"🎟️", name:"Window Shopper",          description:"O's on scenes from 10 different studios.",     current:d.oStudioCount||0,  target:10, tier:"medium" });
      add({ id:"studio-variety-25", category:"Variety", icon:"🛍️", name:"Studio Hopper",           description:"O's on scenes from 25 different studios.",     current:d.oStudioCount||0,  target:25, tier:"hard"   });

      // Playtime
      const maxMins = d.maxPerformerPlayMins ? d.maxPerformerPlayMins.mins : 0;
      add({ id:"deep-dive",      category:"Variety", icon:"🤿", name:"Deep Dive",       description:"Rack up 1+ hour of cumulative watch time with O's on the same performer.", current:Math.round(maxMins/60*10)/10, target:1, tier:"easy",   performerId:d.maxPerformerPlayMins?d.maxPerformerPlayMins.performerId:null, performerName:d.maxPerformerPlayMins?d.maxPerformerPlayMins.performerName:null });
      add({ id:"weekend-binge",  category:"Variety", icon:"🍿", name:"Weekend Binge",   description:"Rack up 3+ hours of cumulative watch time with O's on the same performer.", current:Math.round(maxMins/60*10)/10, target:3, tier:"medium", performerId:d.maxPerformerPlayMins?d.maxPerformerPlayMins.performerId:null, performerName:d.maxPerformerPlayMins?d.maxPerformerPlayMins.performerName:null });

      // Performer stats combo
      const wellRounded = (d.oCountries.size>=5 && d.oDecades.size>=4 && d.oHairColors.size>=3) ? 1 : 0;
      add({ id:"well-rounded", category:"Variety", icon:"🎓", name:"Well-Rounded",      description:"O's spanning 5+ countries, 4+ decades, and 3+ hair colors — true variety.", current:wellRounded, target:1, tier:"hard" });
    }

    // O events — timing variety (how many distinct time-of-day/date achievements triggered)
    if (d.hasOHistory) {
      const timingKeys = Object.keys(t).filter(k => t[k]);
      add({ id:"time-connoisseur", category:"Variety", icon:"🕰️", name:"Time Connoisseur", description:"Trigger 6 different O timing patterns (night owl, early bird, holidays, etc).", current:timingKeys.length, target:6,  tier:"medium" });
      add({ id:"chrono-master",    category:"Variety", icon:"⏱️", name:"Chrono Master",    description:"Trigger 12 different O timing patterns.",                                    current:timingKeys.length, target:12, tier:"hard"   });
    }

    // DEDICATION — library longevity & consistency
    add({ id:"library-age-1y", category:"Dedication", icon:"🌱", name:"One Trip Around the Sun",  description:"Your library's oldest added scene is 1+ year old.", current:d.libraryAgeDays||0, target:365,  tier:"medium" });
    add({ id:"library-age-3y", category:"Dedication", icon:"🌳", name:"Old Growth",                description:"Your library's oldest added scene is 3+ years old.", current:d.libraryAgeDays||0, target:1095, tier:"hard"   });
    add({ id:"active-months-6",category:"Dedication", icon:"📈", name:"Creature of Habit",         description:"Added scenes in 6 different calendar months.",      current:d.activeMonthCount||0, target:6,  tier:"medium" });
    add({ id:"active-months-12",category:"Dedication",icon:"🗓️", name:"Year-Round Curator",        description:"Added scenes in 12 different calendar months.",     current:d.activeMonthCount||0, target:12, tier:"hard"   });
    add({ id:"bulk-import-day",  category:"Dedication", icon:"📥", name:"Bulk Import",     description:"Add 50+ scenes to your library in a single day.",       current:d.maxScenesInDay||0,   target:50,  tier:"medium", days:d.maxScenesInDayInfo?[d.maxScenesInDayInfo]:[] });
    add({ id:"mega-import-day",  category:"Dedication", icon:"📦", name:"Mega Import",      description:"Add 200+ scenes to your library in a single day.",      current:d.maxScenesInDay||0,   target:200, tier:"hard",   days:d.maxScenesInDayInfo?[d.maxScenesInDayInfo]:[] });
    add({ id:"big-month",        category:"Dedication", icon:"📅", name:"Big Month",        description:"Add 100+ scenes to your library in a single calendar month.", current:d.maxScenesInMonth||0, target:100, tier:"medium", days:d.maxScenesInMonthInfo?[d.maxScenesInMonthInfo]:[] });
    add({ id:"massive-month",    category:"Dedication", icon:"🗃️", name:"Massive Month",    description:"Add 500+ scenes to your library in a single calendar month.", current:d.maxScenesInMonth||0, target:500, tier:"hard",   days:d.maxScenesInMonthInfo?[d.maxScenesInMonthInfo]:[] });

    // SPECIAL MOMENTS
    if (d.hasOHistory) {
      add({ id:"double-shot",       category:"Special Moments", icon:"⚡", name:"Double Shot",         description:"Two O's within 30 minutes of each other.",               current:t.doubleShot?1:0,        target:1, total:tc.doubleShot||0, tier:"medium", sceneId:sceneRef("doubleShot") });
      add({ id:"triple-shot",       category:"Special Moments", icon:"🚨", name:"Triple Shot",         description:"Three O's within 1 hour.",                                current:t.tripleShot?1:0,        target:1, total:tc.tripleShot||0, tier:"hard",   sceneId:sceneRef("tripleShot") });
      add({ id:"five-one-day",      category:"Special Moments", icon:"🖐️", name:"High Five",           description:"5 O's in a single day.",                                  current:t.fiveInOneDay?1:0,      target:1, total:tc.fiveInOneDay||0, tier:"hard",   sceneId:sceneRef("fiveInOneDay") });
      add({ id:"three-of-kind",     category:"Special Moments", icon:"🎰", name:"Three of a Kind",     description:"3 O's in a single day.",                                  current:(d.threeOfKindDays&&d.threeOfKindDays.length)?1:0, target:1, tier:"medium", days:d.threeOfKindDays||[] });
      add({ id:"friday-night",      category:"Special Moments", icon:"🍸", name:"Friday Night In",     description:"O after 9pm on a Friday or Saturday.",                    current:t.fridayNight?1:0,       target:1, total:tc.fridayNight||0, tier:"easy",   sceneId:sceneRef("fridayNight") });
      add({ id:"weekend-warrior",   category:"Special Moments", icon:"🛋️", name:"Weekend Warrior",     description:"O on a Saturday or Sunday.",                              current:t.weekendWarrior?1:0,    target:1, total:tc.weekendWarrior||0, tier:"easy",   sceneId:sceneRef("weekendWarrior") });
      add({ id:"monday-morning",    category:"Special Moments", icon:"😩", name:"Case of the Mondays", description:"O on a Monday before 9am. Brave.",                        current:t.mondayMorning?1:0,     target:1, total:tc.mondayMorning||0, tier:"hard",   sceneId:sceneRef("mondayMorning") });
      add({ id:"siesta",            category:"Special Moments", icon:"😴", name:"La Siesta",           description:"O between 2pm and 4pm. Mediterranean lifestyle.",         current:t.siesta?1:0,            target:1, total:tc.siesta||0, tier:"easy",   sceneId:sceneRef("siesta") });
      add({ id:"holiday-o",         category:"Special Moments", icon:"🎊", name:"Holiday Spirit",      description:"O on a major holiday.",                                   current:t.holidayO?1:0,          target:1, total:tc.holidayO||0, tier:"medium", sceneId:sceneRef("holidayO") });
      add({ id:"nye-countdown",     category:"Special Moments", icon:"🎆", name:"Countdown to O",      description:"O within 5 minutes of midnight on New Year's Eve.",       current:t.newYearsCountdown?1:0, target:1, total:tc.newYearsCountdown||0, tier:"hard",   sceneId:sceneRef("newYearsCountdown") });
      add({ id:"valentines",        category:"Special Moments", icon:"💝", name:"Be My Valentine",     description:"O on Valentine's Day.",                                   current:t.valentinesO?1:0,       target:1, total:tc.valentinesO||0, tier:"medium", sceneId:sceneRef("valentinesO") });
      add({ id:"halloween",         category:"Special Moments", icon:"🎃", name:"Trick or Treat",      description:"O on Halloween.",                                         current:t.halloweenO?1:0,        target:1, total:tc.halloweenO||0, tier:"medium", sceneId:sceneRef("halloweenO") });
      add({ id:"christmas",         category:"Special Moments", icon:"🎄", name:"Santa's Little Helper",description:"O on Christmas Day.",                                    current:t.christmasO?1:0,        target:1, total:tc.christmasO||0, tier:"medium", sceneId:sceneRef("christmasO") });
      add({ id:"hump-day",          category:"Special Moments", icon:"🐫", name:"Hump Day",            description:"O on a Wednesday.",                                       current:t.humpDay?1:0,           target:1, total:tc.humpDay||0, tier:"easy",   sceneId:sceneRef("humpDay") });
      add({ id:"saturday-cartoons", category:"Special Moments", icon:"📺", name:"Saturday Cartoons",   description:"O on a Saturday morning between 6am and 10am.",           current:t.saturdayCartoons?1:0,  target:1, total:tc.saturdayCartoons||0, tier:"easy",   sceneId:sceneRef("saturdayCartoons") });
      add({ id:"sunday-scaries",    category:"Special Moments", icon:"😰", name:"Sunday Scaries",      description:"O on a Sunday evening between 6pm and 10pm.",             current:t.sundayScaries?1:0,     target:1, total:tc.sundayScaries||0, tier:"medium", sceneId:sceneRef("sundayScaries") });
      add({ id:"friday-13th",       category:"Special Moments", icon:"🔪", name:"Friday the 13th",     description:"O on a Friday the 13th. Unlucky for some.",               current:t.fridayThe13th?1:0,     target:1, total:tc.fridayThe13th||0, tier:"hard",   sceneId:sceneRef("fridayThe13th") });
      add({ id:"independence-day",  category:"Special Moments", icon:"🎆", name:"Fireworks Show",      description:"O on July 4th.",                                          current:t.independenceDay?1:0,   target:1, total:tc.independenceDay||0, tier:"medium", sceneId:sceneRef("independenceDay") });
      add({ id:"fresh-start",       category:"Special Moments", icon:"🥂", name:"Fresh Start",         description:"O on New Year's Day.",                                    current:t.freshStart?1:0,        target:1, total:tc.freshStart||0, tier:"medium", sceneId:sceneRef("freshStart") });
    }
    if (d.hasOHistory && d.hasODetail) {
      add({ id:"nightcap",          category:"Special Moments", icon:"🥃", name:"Nightcap",            description:"O after 10pm featuring a performer aged 50+.",            current:t.matureNightcap?1:0,    target:1, total:tc.matureNightcap||0, tier:"hard",   sceneId:sceneRef("matureNightcap") });
      add({ id:"sunday-matinee",    category:"Special Moments", icon:"🎭", name:"Sunday Matinée",      description:"Weekend afternoon O with a performer from abroad.",        current:t.sundayMatinee?1:0,     target:1, total:tc.sundayMatinee||0, tier:"medium", sceneId:sceneRef("sundayMatinee") });
      add({ id:"midnight-rebel",    category:"Special Moments", icon:"💀", name:"Midnight Rebellion",  description:"O at midnight on a scene with a tattooed/pierced performer.",current:t.midnightRebellion?1:0,target:1, total:tc.midnightRebellion||0, tier:"hard",  sceneId:sceneRef("midnightRebellion") });
    }

    // CHROMATIC MOMENTS — body stat (hair/eye colour, height, weight) × time-of-day/week/year combos
    if (d.hasOHistory && d.hasODetail) {
      CHROMA_RULES.forEach(rule => {
        add({ id:rule.id, category:"Chromatic Moments", icon:rule.icon, name:rule.name, description:rule.desc,
          current:t[rule.flag]?1:0, target:1, tier:rule.tier, total:tc[rule.flag]||0, sceneId:sceneRef(rule.flag) });
      });
    }

    // SPECIAL DAY ENCOUNTERS — a performer characteristic (body art, age, favorite,
    // hair/eye colour) lining up with a specific calendar date.
    if (d.hasOHistory && d.hasODetail) {
      HOLIDAY_CHAR_RULES.forEach(rule => {
        add({ id:rule.id, category:"Special Day Encounters", icon:rule.icon, name:rule.name, description:rule.desc,
          current:t[rule.flag]?1:0, target:1, tier:rule.tier, total:tc[rule.flag]||0, sceneId:sceneRef(rule.flag) });
      });
    }

    // PLAYTIME PATTERNS — cumulative watch time (across O'd scenes) logged on
    // specific days of the week.
    if (d.hasOHistory && d.playtimeByWeekday) {
      const pw = d.playtimeByWeekday; // index 0=Sun..6=Sat
      const psw = d.playtimeScenesByWeekday || [[],[],[],[],[],[],[]];
      const weekendMins = pw[0] + pw[6];
      const weekendScenes = [...psw[0], ...psw[6]];
      [
        { id:"weekend-marathon",  icon:"🛋️", name:"Weekend Marathon",   desc:"Rack up 10+ hours of watch time from O's logged on a Saturday or Sunday.", mins:weekendMins,     target:600, tier:"medium", scenes:weekendScenes },
        { id:"friday-night-fever",icon:"🕺", name:"Friday Night Fever", desc:"Rack up 5+ hours of watch time from O's logged on a Friday.",              mins:pw[5],           target:300, tier:"medium", scenes:psw[5] },
        { id:"sunday-funday",     icon:"☀️", name:"Sunday Funday",      desc:"Rack up 3+ hours of watch time from O's logged on a Sunday.",              mins:pw[0],           target:180, tier:"easy",   scenes:psw[0] },
        { id:"hump-day-hustle",   icon:"🐫", name:"Hump Day Hustle",    desc:"Rack up 3+ hours of watch time from O's logged on a Wednesday.",           mins:pw[3],           target:180, tier:"easy",   scenes:psw[3] },
        { id:"monday-marathon",   icon:"😴", name:"Monday Blues Marathon", desc:"Rack up 5+ hours of watch time from O's logged on a Monday.",          mins:pw[1],           target:300, tier:"medium", scenes:psw[1] },
      ].forEach(cfg => {
        add({ id:cfg.id, category:"Playtime Patterns", icon:cfg.icon, name:cfg.name, description:cfg.desc,
          current:Math.round(cfg.mins*60), target:cfg.target*60, tier:cfg.tier, format:"hours", sceneList:cfg.scenes });
      });
    }

    // "Happy Birthday to Me" — always shown, regardless of O history, since the
    // upcoming-birthday lookup spans all performers.
    {
      const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      let birthdayDesc = "O on a scene with a performer whose birthday is today.";
      if (d.birthdayInfo) {
        birthdayDesc = `O on a scene with ${d.birthdayInfo.performerName}, whose birthday is today!`;
      } else if (d.upcomingBirthday) {
        const ub = d.upcomingBirthday;
        const when = ub.daysUntil===1 ? "tomorrow" : `in ${ub.daysUntil} days (${MONTH_NAMES[ub.month]} ${ub.day})`;
        birthdayDesc = `O on a scene with a performer whose birthday is today. Next up: ${ub.performerName}'s birthday is ${when}.`;
      }
      add({ id:"birthday-o", category:"Special Moments", icon:"🎂", name:"Happy Birthday to Me", description:birthdayDesc, current:d.birthdayOFound?1:0, target:1, tier:"hard",
        sceneId: d.birthdayInfo?d.birthdayInfo.sceneId:null,
        performerId: d.birthdayInfo?d.birthdayInfo.performerId:(d.upcomingBirthday?d.upcomingBirthday.performerId:null),
        performerName: d.birthdayInfo?d.birthdayInfo.performerName:(d.upcomingBirthday?d.upcomingBirthday.performerName:null),
      });
    }

    // TAG CHALLENGES
    if (d.hasTagAchievements) {
      TAG_ACHIEVEMENTS.forEach(cfg => {
        add({ id:cfg.id, category:"Tag Challenges", icon:cfg.icon, name:cfg.name, description:cfg.description, current:d.tagCounts[cfg.id]||0, target:cfg.target, tier:cfg.tier });
      });
    }

    // PERFORMER COMPLETION — how much of a performer's total scene catalog has
    // been O'd, plus "devotion" achievements for rewatching the same performer's
    // scenes more times than she has scenes.
    if (d.performerCompletions) {
      const pc = d.performerCompletions;
      const listAt = pct => pc.filter(c => c.pct >= pct).sort((a,b)=>b.pct-a.pct);
      [
        { id:"completion-25",  pct:25,  tier:"easy",   icon:"🔓", name:"Getting Started",     desc:"O at least 25% of a performer's scenes (3+ scenes in her catalog)." },
        { id:"completion-50",  pct:50,  tier:"medium", icon:"📀", name:"Halfway There",        desc:"O at least 50% of a performer's scenes (3+ scenes in her catalog)." },
        { id:"completion-75",  pct:75,  tier:"medium", icon:"📈", name:"Almost There",         desc:"O at least 75% of a performer's scenes (3+ scenes in her catalog)." },
        { id:"completion-100", pct:100, tier:"hard",   icon:"🏁", name:"Full Completion",      desc:"O every single scene a performer has (3+ scenes in her catalog)." },
      ].forEach(cfg => {
        const matches = listAt(cfg.pct);
        add({ id:cfg.id, category:"Performer Completion", icon:cfg.icon, name:cfg.name, description:cfg.desc,
          current:matches.length?1:0, target:1, tier:cfg.tier, performerList:matches });
      });
      const full100 = listAt(100);
      add({ id:"multi-completionist", category:"Performer Completion", icon:"🎓", name:"Completionist",
        description:"Reach 100% completion on 3 different performers.", current:full100.length, target:3, tier:"hard", performerList:full100 });
    }
    if (d.performerDevotees) {
      const dv = d.performerDevotees;
      [
        { id:"devoted-fan",    ratio:1,   tier:"medium", icon:"💗", name:"Devoted Fan",     desc:"Log more O's than a performer has scenes — you keep coming back." },
        { id:"super-devotee",  ratio:2,   tier:"hard",   icon:"💖", name:"Super Devotee",   desc:"Log at least 2x more O's than a performer has scenes." },
        { id:"obsessive-devotee", ratio:3,tier:"hard",   icon:"💘", name:"Obsessive Devotee",desc:"Log at least 3x more O's than a performer has scenes." },
        { id:"ultra-devotee",  ratio:5,   tier:"hard",   icon:"👑", name:"Ultra Devotee",    desc:"Log at least 5x more O's than a performer has scenes. Absolute loyalty." },
      ].forEach(cfg => {
        const matches = dv.filter(x => x.ratio >= cfg.ratio);
        add({ id:cfg.id, category:"Performer Completion", icon:cfg.icon, name:cfg.name, description:cfg.desc,
          current:matches.length?1:0, target:1, tier:cfg.tier, performerList:matches });
      });
    }

    // MONTHLY BREAKDOWN — competitiveness of the Monthly Breakdown tab's podium:
    // how many performers were in the running in a single month, and how close
    // the top two finished.
    if (d.hasOHistory) {
      add({ id:"crowded-field", category:"Monthly Breakdown", icon:"🧑‍🤝‍🧑", name:"Crowded Field", description:"Have 10+ different performers score O's within the same calendar month.", current:d.maxCompetitorsMonth||0, target:10, tier:"medium" });
      add({ id:"packed-house",  category:"Monthly Breakdown", icon:"🏟️", name:"Packed House",   description:"Have 20+ different performers score O's within the same calendar month.", current:d.maxCompetitorsMonth||0, target:20, tier:"hard"   });
      {
        const cri = d.closestRaceInfo;
        const photoFinishUnlocked = !!(cri && d.closestRaceGap!=null && d.closestRaceGap<=10);
        const photoFinishDesc = cri
          ? `Have a month where the top two Monthly Breakdown performers finish within 10 points of each other. Closest so far: ${monthLabel(cri.month)} — a gap of ${cri.gap} pts.`
          : "Have a month where the top two Monthly Breakdown performers finish within 10 points of each other.";
        const photoFinishList = photoFinishUnlocked ? [
          { performerId:cri.top.performerId,    performerName:cri.top.performerName,    points:cri.top.score },
          { performerId:cri.second.performerId, performerName:cri.second.performerName, points:cri.second.score },
        ] : [];
        add({ id:"photo-finish", category:"Monthly Breakdown", icon:"🏁", name:"Photo Finish", description:photoFinishDesc, current:photoFinishUnlocked?1:0, target:1, tier:"hard", performerList:photoFinishList });
      }
    }

    // PERFORMER NETWORK — longest chain of O'd performers connected through
    // shared scenes (A co-starred with B, B with C, ...), approximated via
    // double-sweep BFS over the co-star graph.
    if (d.performerChain) {
      const chainLen = d.performerChain.length;
      [
        { id:"chain-3",  threshold:3,  tier:"easy",   icon:"🔗", name:"Six Degrees",             desc:"Find a chain of 3+ links connecting O'd performers through shared scenes." },
        { id:"chain-5",  threshold:5,  tier:"medium", icon:"🕸️", name:"Social Network",           desc:"Find a chain of 5+ links connecting O'd performers through shared scenes." },
        { id:"chain-8",  threshold:8,  tier:"hard",   icon:"🌐", name:"Small World",              desc:"Find a chain of 8+ links connecting O'd performers through shared scenes." },
        { id:"chain-12", threshold:12, tier:"hard",   icon:"🪐", name:"Six Degrees of Everyone",  desc:"Find a chain of 12+ links connecting O'd performers through shared scenes." },
      ].forEach(cfg => {
        add({ id:cfg.id, category:"Performer Network", icon:cfg.icon, name:cfg.name, description:cfg.desc,
          current:chainLen, target:cfg.threshold, tier:cfg.tier,
          chain: chainLen>=cfg.threshold ? d.performerChain.path : null,
          chainLinks: chainLen>=cfg.threshold ? d.performerChain.links : null });
      });
    }

    // LEGACY — based on Performer of the Year data across multiple years
    if (d.hasOHistory) {
      add({ id:"repeat-champion", category:"Legacy", icon:"👑", name:"Repeat Champion",     description:"The same performer tops your yearly O rankings in 2 different years.", current:d.repeatChampion?d.repeatChampion.years:0, target:2, tier:"medium", performerPopup:true, performerId:d.repeatChampion?d.repeatChampion.performerId:null, performerName:d.repeatChampion?d.repeatChampion.performerName:null });
      add({ id:"dynasty",         category:"Legacy", icon:"🏰", name:"Dynasty",             description:"The same performer tops your yearly O rankings in 3 different years.", current:d.repeatChampion?d.repeatChampion.years:0, target:3, tier:"hard",   performerPopup:true, performerId:d.repeatChampion?d.repeatChampion.performerId:null, performerName:d.repeatChampion?d.repeatChampion.performerName:null });
      add({ id:"changing-guard",  category:"Legacy", icon:"🔄", name:"Changing of the Guard",description:"This year's top-O'd performer differs from last year's.",             current:d.guardChanged?1:0, target:1, tier:"easy",   performerPopup:true, performerId:d.guardChanged?d.guardChanged.performerId:null, performerName:d.guardChanged?d.guardChanged.performerName:null });
    }

    a.push(...getORatingAchievements(d));

    return a;
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function Modal({ onClose, children, className }) {
    useEffect(() => {
      const onKey = e => { if (e.key === "Escape") onClose(); };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    return h("div", { className:"stash-plus-modal-backdrop", onClick:onClose },
      h("div", { className:"stash-plus-modal"+(className?" "+className:""), onClick:e=>e.stopPropagation() },
        h("button", { className:"stash-plus-modal-close", onClick:onClose, "aria-label":"Close" }, "✕"),
        children
      )
    );
  }

  function formatDuration(totalSeconds) {
    if (!totalSeconds) return null;
    const hrs = Math.floor(totalSeconds/3600);
    const mins = Math.round((totalSeconds%3600)/60);
    return hrs>0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }

  function SceneInfoModal({ sceneId, onClose }) {
    const [state, setState] = useState({ loading:true, error:null, scene:null });

    useEffect(() => {
      let cancelled = false;
      setState({ loading:true, error:null, scene:null });
      gqlQuery(`query($id: ID!) {
        findScene(id: $id) {
          id title date o_counter rating100 details
          paths { screenshot }
          studio { name }
          performers { id name }
          files { duration }
        }
      }`, { id: sceneId })
        .then(data => { if (!cancelled) setState({ loading:false, error:null, scene:data.findScene }); })
        .catch(err  => { if (!cancelled) setState({ loading:false, error:err.message, scene:null }); });
      return () => { cancelled = true; };
    }, [sceneId]);

    const { Link } = PluginApi.libraries.ReactRouterDOM;

    return h(Modal, { onClose, className:"stash-plus-scene-modal" },
      state.loading && h("div", { className:"stash-plus-loading" }, "Loading scene…"),
      state.error   && h("div", { className:"stash-plus-error"   }, "Error: "+state.error),
      state.scene && h(React.Fragment, null,
        state.scene.paths && state.scene.paths.screenshot &&
          h("img", { className:"stash-plus-scene-cover", src:state.scene.paths.screenshot, alt:state.scene.title||"Scene" }),
        h("div", { className:"stash-plus-scene-info" },
          h("h3", null, state.scene.title || "(Untitled scene)"),
          h("div", { className:"stash-plus-scene-meta" },
            state.scene.date && h("span", null, "📅 "+state.scene.date),
            state.scene.studio && h("span", null, "🏢 "+state.scene.studio.name),
            formatDuration(state.scene.files && state.scene.files[0] && state.scene.files[0].duration) && h("span", null, "⏱️ "+formatDuration(state.scene.files[0].duration)),
            state.scene.rating100!=null && h("span", null, "⭐ "+(state.scene.rating100/10).toFixed(1)+"/10"),
            h("span", null, "💦 "+(state.scene.o_counter||0))
          ),
          state.scene.performers && state.scene.performers.length>0 && h("div", { className:"stash-plus-scene-performers" },
            state.scene.performers.map(p => h(Link, { key:p.id, to:`/performers/${p.id}`, onClick:onClose }, p.name))
          ),
          h(Link, { to:`/scenes/${state.scene.id}`, className:"stash-plus-scene-open", onClick:onClose }, "Open scene →")
        )
      )
    );
  }

  function ThreeOfKindModal({ days, onClose, onSelectScene }) {
    const [sceneInfo, setSceneInfo] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      const allIds = Array.from(new Set(days.flatMap(dEntry => dEntry.sceneIds)));
      Promise.all(allIds.map(id =>
        gqlQuery(`query($id: ID!) { findScene(id:$id) { id title date o_counter paths { screenshot } } }`, { id })
          .then(data => ({ id, info: data.findScene }))
          .catch(() => ({ id, info: null }))
      )).then(results => {
        if (cancelled) return;
        const map = {};
        results.forEach(r => { map[r.id] = r.info; });
        setSceneInfo(map);
        setLoading(false);
      });
      return () => { cancelled = true; };
    }, [days]);

    const sorted = [...days].sort((a,b) => b.date.localeCompare(a.date));

    return h(Modal, { onClose },
      h("h3", { style:{ marginTop:0 } }, "🎰 Three of a Kind"),
      h("p", { className:"stash-plus-score-note" }, "Days with 3 or more O's logged, and the scenes played that day."),
      loading && h("div", { className:"stash-plus-loading" }, "Loading scenes…"),
      !loading && sorted.map(entry =>
        h("div", { key:entry.date, style:{ marginBottom:"1.25rem" } },
          h("div", { style:{ fontWeight:600, marginBottom:"0.5rem" } }, `${entry.date} (${entry.sceneIds.length} scene${entry.sceneIds.length!==1?"s":""})`),
          entry.sceneIds.map(sid => {
            const sc = sceneInfo[sid];
            return h("div", {
                key:sid,
                onClick:()=>onSelectScene(sid),
                style:{ display:"flex", alignItems:"center", gap:"0.75rem", padding:"0.5rem", borderRadius:"8px", cursor:"pointer", background:"rgba(255,255,255,0.04)", marginBottom:"0.4rem" },
              },
              (sc && sc.paths && sc.paths.screenshot)
                ? h("img", { src:sc.paths.screenshot, alt:sc.title||"Scene", style:{ width:"120px", height:"68px", objectFit:"cover", borderRadius:"4px", flexShrink:0 } })
                : h("div", { style:{ width:"120px", height:"68px", flexShrink:0, background:"rgba(255,255,255,0.08)", borderRadius:"4px" } }),
              h("div", { style:{ minWidth:0 } },
                h("div", { style:{ fontWeight:600, fontSize:"0.9rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, sc ? (sc.title||"(Untitled scene)") : "Loading…"),
                sc && h("div", { style:{ fontSize:"0.75rem", opacity:0.7 } }, `💦 ${sc.o_counter||0}` + (sc.date ? ` · 📅 ${sc.date}` : ""))
              )
            );
          })
        )
      )
    );
  }

  function PerformerInfoModal({ performerId, onClose }) {
    const [state, setState] = useState({ loading:true, error:null, performer:null });

    useEffect(() => {
      let cancelled = false;
      setState({ loading:true, error:null, performer:null });
      gqlQuery(`query($id: ID!) {
        findPerformer(id: $id) { id name image_path birthdate country }
      }`, { id: performerId })
        .then(data => { if (!cancelled) setState({ loading:false, error:null, performer:data.findPerformer }); })
        .catch(err  => { if (!cancelled) setState({ loading:false, error:err.message, performer:null }); });
      return () => { cancelled = true; };
    }, [performerId]);

    const { Link } = PluginApi.libraries.ReactRouterDOM;

    return h(Modal, { onClose },
      state.loading && h("div", { className:"stash-plus-loading" }, "Loading performer…"),
      state.error   && h("div", { className:"stash-plus-error"   }, "Error: "+state.error),
      state.performer && h(React.Fragment, null,
        state.performer.image_path &&
          h("img", { className:"stash-plus-scene-cover", src:state.performer.image_path, alt:state.performer.name }),
        h("h3", null, state.performer.name),
        (state.performer.country || state.performer.birthdate) && h("div", { className:"stash-plus-scene-meta" },
          state.performer.country  && h("span", null, "🌍 "+state.performer.country),
          state.performer.birthdate && h("span", null, "🎂 "+state.performer.birthdate)
        ),
        h(Link, { to:`/performers/${state.performer.id}`, className:"stash-plus-scene-open", onClick:onClose }, "Open performer →")
      )
    );
  }

  function PerformerListModal({ heading, subheading, performers, onClose, onSelectPerformer }) {
    return h(Modal, { onClose },
      h("h3", { style:{ marginTop:0 } }, heading),
      subheading && h("p", { className:"stash-plus-score-note" }, subheading),
      performers.length===0 && h("div", { style:{ opacity:0.6, fontSize:"0.85rem" } }, "No performers match yet."),
      performers.map(p =>
        h("div", {
            key:p.performerId,
            onClick:()=>onSelectPerformer(p.performerId),
            className:"podium-row",
          },
          p.image_path
            ? h("img", { src:p.image_path, alt:p.performerName, className:"podium-row-avatar", onError:e=>e.target.style.display="none" })
            : h("div", { className:"podium-row-avatar podium-avatar-placeholder" }, "🎭"),
          h("div", { className:"podium-row-info" },
            h("span", { className:"podium-row-name" }, p.performerName),
            h("span", { className:"podium-row-reason" },
              p.note!=null    ? p.note
              : p.points!=null ? `${p.points} pts`
              : p.pct!=null    ? `${p.oScenes} / ${p.totalScenes} scenes O'd (${p.pct}%)`
                               : `${p.oSum} O's on ${p.totalScenes} scene${p.totalScenes!==1?"s":""} (${p.ratio.toFixed(1)}×)`
            )
          )
        )
      )
    );
  }

  function PerformerChainModal({ heading, path, links, onClose, onSelectPerformer, onSelectScene }) {
    return h(Modal, { onClose },
      h("h3", { style:{ marginTop:0 } }, heading),
      h("p", { className:"stash-plus-score-note" }, `${path.length} performers, ${links.length} link${links.length!==1?"s":""}. Click a name to view her, or the arrow to view the connecting scene.`),
      path.map((p,i) => h(React.Fragment, { key:p.performerId },
        h("div", {
            onClick:()=>onSelectPerformer(p.performerId),
            className:"podium-row",
          },
          h("span", { className:"podium-row-rank" }, i+1),
          h("span", { className:"podium-row-name" }, p.performerName)
        ),
        i < links.length && h("div", {
            onClick:()=>onSelectScene(links[i].sceneId),
            style:{ textAlign:"center", cursor:"pointer", opacity:0.6, fontSize:"0.8rem", padding:"0.15rem 0" },
            title:"View the connecting scene",
          }, "⬇ shared scene ⬇")
      ))
    );
  }

  function SceneListModal({ heading, subheading, scenes, onClose, onSelectScene }) {
    const fmtMins = mins => { const h2=Math.floor(mins/60), m=Math.round(mins%60); return h2>0?`${h2}h ${m}m`:`${m}m`; };
    return h(Modal, { onClose },
      h("h3", { style:{ marginTop:0 } }, heading),
      subheading && h("p", { className:"stash-plus-score-note" }, subheading),
      scenes.map(sc =>
        h("div", {
            key:sc.id + (sc.t ? "-" + sc.t : ""),
            onClick:()=>onSelectScene(sc.id),
            style:{ display:"flex", alignItems:"center", gap:"0.75rem", padding:"0.4rem 0", borderBottom:"1px solid rgba(255,255,255,0.06)", cursor:"pointer", fontSize:"0.85rem",
              background: sc.diffDaysLabel==="Rewatch" ? "rgba(255,200,80,0.08)" : "transparent" },
          },
          sc.screenshot
            ? h("img", { src:sc.screenshot, alt:sc.title, style:{ width:"120px", height:"68px", objectFit:"cover", borderRadius:"4px", flexShrink:0 } })
            : h("div", { style:{ width:"120px", height:"68px", flexShrink:0, background:"rgba(255,255,255,0.08)", borderRadius:"4px" } }),
          h("div", { style:{ flex:1, minWidth:0 } },
            h("div", { style:{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, sc.title),
            sc.performerNames && sc.performerNames.length>0 && h("div", { style:{ opacity:0.7, fontSize:"0.78rem", marginTop:"0.1rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, sc.performerNames.join(", ")),
            h("div", { style:{ opacity:0.7, fontSize:"0.78rem", marginTop:"0.15rem" } },
              [
                sc.rating100!=null ? `${(sc.rating100/10).toFixed(1)}/10` : "unrated",
                sc.durMins ? fmtMins(sc.durMins) : null,
                sc.oCounter!=null ? `💦 ${sc.oCounter}` : null,
                sc.diffDaysLabel || null,
              ].filter(Boolean).join(" · ")
            ),
            sc.oRating100 !== undefined && h("div", { style:{ fontSize:"0.8rem", marginTop:"0.2rem", color:"#ffc850", fontWeight:600 } },
              sc.oRating100 != null ? `🗳️ O vote: ${(sc.oRating100/10).toFixed(1)}/10` : "🗳️ O not voted"),
            sc.oComment && h("div", { style:{ fontSize:"0.78rem", marginTop:"0.2rem", opacity:0.9, whiteSpace:"pre-wrap", wordBreak:"break-word" } }, `💬 ${sc.oComment}`)
          )
        )
      )
    );
  }

  // ── UI components ─────────────────────────────────────────────────────────
  const TIER_LABELS = { easy:"Easy", medium:"Medium", hard:"Hard" };
  const TIER_COLORS = { easy:"#7adba0", medium:"#8ec0ff", hard:"#c79bff" };

  function ProgressBar({ current, target, large, format }) {
    const pct = Math.min(100, Math.round((current / target) * 100));
    let label;
    if (format === "hours") {
      const fmt = s => { const h = Math.floor(s/3600), m = Math.round((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m`; };
      label = `${fmt(Math.min(current,target))} / ${fmt(target)}`;
    } else {
      label = `${Math.min(current,target).toLocaleString()} / ${target.toLocaleString()}`;
    }
    return h("div", { className:"stash-plus-progress-wrap" },
      h("div", { className:"stash-plus-progress" + (large?" stash-plus-progress-large":"") },
        h("div", { className:"stash-plus-progress-bar", style:{ width:pct+"%" } })
      ),
      !large && h("div", { className:"stash-plus-progress-label" }, label)
    );
  }

  function AchievementCard({ a, unlocked, onOpenScene, onOpenDays, onOpenPerformer, onOpenPerformerList, onOpenChain, onOpenSceneList }) {
    const { Link } = PluginApi.libraries.ReactRouterDOM;

    const hasDays = a.days && a.days.length > 0;
    const hasPerformerPopup = a.performerPopup && a.performerId;
    const hasPerformerList = a.performerList && a.performerList.length > 0;
    const hasChain = a.chain && a.chain.length > 1;
    const hasSceneList = a.sceneList && a.sceneList.length > 0;
    const clickable = unlocked && (a.sceneId || hasDays || hasPerformerPopup || hasPerformerList || hasChain || hasSceneList);
    const handleClick = () => {
      if (!clickable) return;
      if (hasChain) onOpenChain({ heading:`${a.icon} ${a.name}`, path:a.chain, links:a.chainLinks||[] });
      else if (hasPerformerList) onOpenPerformerList({ heading:`${a.icon} ${a.name}`, subheading:a.description, performers:a.performerList });
      else if (hasSceneList) onOpenSceneList({ heading:`${a.icon} ${a.name}`, subheading:a.description, scenes:a.sceneList });
      else if (hasDays) onOpenDays(a.days);
      else if (hasPerformerPopup) onOpenPerformer(a.performerId);
      else onOpenScene(a.sceneId);
    };
    const clickTitle = hasChain ? "View the chain" : hasPerformerList ? "View matching performers" : hasSceneList ? "View scenes" : hasDays ? "View days" : hasPerformerPopup ? "View performer" : "View the scene";

    return h("div", {
        className:"stash-plus-card" + (unlocked?" unlocked":"") + (a.tier?" tier-"+a.tier:"") + (clickable?" clickable":""),
        onClick: clickable ? handleClick : undefined,
        role: clickable ? "button" : undefined,
        tabIndex: clickable ? 0 : undefined,
        title: clickable ? clickTitle : undefined,
      },
      h("div", { className:"stash-plus-card-icon" }, a.icon),
      h("div", { className:"stash-plus-card-body" },
        h("div", { className:"stash-plus-card-title" },
          a.name,
          a.tier && h("span", { className:"stash-plus-tier stash-plus-tier-"+a.tier, style:{ color:TIER_COLORS[a.tier] } }, TIER_LABELS[a.tier]),
          unlocked && h("span", { className:"stash-plus-badge" }, "Unlocked")
        ),
        h("div", { className:"stash-plus-card-desc" }, a.description),
        a.performerId && !hasPerformerPopup && h("div", { className:"stash-plus-card-link" },
          h(Link, { to:`/performers/${a.performerId}`, onClick:e=>e.stopPropagation() }, `🎈 ${a.performerName}`)
        ),
        h(ProgressBar, { current:a.current, target:a.target, format:a.format }),
        (() => {
          // "Total" surfaces the real number of qualifying scenes/performers,
          // since the progress bar itself clamps at the target (e.g. a 1/1
          // "at least one" achievement, or a 5/5 bar when you actually have 8).
          let totalVal = null;
          if (a.total != null) totalVal = a.total;
          else if (a.format !== "hours" && typeof a.current === "number" && a.current > a.target) totalVal = a.current;
          if (totalVal == null) return null;
          return h("div", { className:"stash-plus-progress-label", style:{ marginTop:"0.2rem" } }, `Total: ${totalVal.toLocaleString()}`);
        })()
      )
    );
  }

  // ── Podium scoring ────────────────────────────────────────────────────────
  // "Quality minutes" = sum over O'd scenes of (scene duration × scene rating norm × O count
  // on that scene). This rewards long, highly-rated scenes much more than short,
  // low-rated ones — a single O on a 2-hour 9/10 scene can outweigh a dozen O's on
  // 5-minute unrated clips.
  function computeScoreParts(s) {
    const logO     = Math.log(s.oCount     + 1) / Math.log(51)  * 100;
    const logScene = Math.log(s.sceneCount + 1) / Math.log(21)  * 100;
    const hasRating   = s.ratingCount > 0;
    const ratingNorm  = hasRating ? s.avgRating / 100 : 0.60;
    const qualityMult = ratingNorm * ratingNorm;
    const volumeScore = (logO * 0.5 + logScene * 0.5) * qualityMult * 40;

    // Quality minutes drive the bulk of the play-time score. We scale with
    // sqrt(hours) (so it grows quickly at first but doesn't run away forever)
    // and multiply up so that meaningful differences in watch time (e.g. +4h of
    // quality viewing) translate into hundreds of points, not single digits —
    // putting it on a comparable scale to the volume/rating components.
    const qualityMins = s.qualityMins || 0;
    const qualityHours = qualityMins / 60;
    const playScore = Math.sqrt(qualityHours) * 600;

    const ratingScore = 0; // rating is a multiplier (via qualityMult / per-O malus), not its own point bucket
    const favBonus    = s.isFavorite ? 5 : 0;
    return { logO, logScene, hasRating, ratingNorm, qualityMult, volumeScore, qualityMins, qualityHours, playScore, ratingScore, favBonus };
  }

  function scorePodiumPerformer(s) {
    const p = computeScoreParts(s);
    return Math.round(p.volumeScore + p.playScore + p.ratingScore + p.favBonus);
  }

  function scoreBreakdown(s) {
    const p = computeScoreParts(s);
    const total = Math.round(p.volumeScore + p.playScore + p.ratingScore + p.favBonus);
    return {
      oCount: s.oCount, sceneCount: s.sceneCount, playMins: s.playMins,
      qualityMins: p.qualityMins, qualityHours: p.qualityHours,
      hasRating: p.hasRating, avgRating: s.avgRating, ratingNorm: p.ratingNorm, qualityMult: p.qualityMult, isFavorite: s.isFavorite,
      volumeScore: p.volumeScore, playScore: p.playScore, ratingScore: p.ratingScore, favBonus: p.favBonus, total,
    };
  }

  function explainScore(s, rank) {
    const r = s.ratingCount > 0 ? s.avgRating : 60;
    const quality = r>=90?"Elite quality":r>=75?"High quality":r>=60?"Solid performer":r>=45?"Average rating":"Low rating";
    const parts = [];
    if (s.oCount)     parts.push(`${s.oCount} O${s.oCount!==1?"s":""}`);
    if (s.sceneCount) parts.push(`${s.sceneCount} scene${s.sceneCount!==1?"s":""}`);
    if (s.ratingCount>0) parts.push(`${(s.avgRating/10).toFixed(1)}/10`); else parts.push("unrated");
    if (s.playMins>0) { const h=Math.floor(s.playMins/60),m=Math.round(s.playMins%60); parts.push(`${h>0?h+"h ":""}${m}m`); }
    if (s.isFavorite) parts.push("favourite ❤️");
    const intros = ["🥇 Champion — ","🥈 Runner-up — ","🥉 Third place — "];
    return `${rank<=3?intros[rank-1]:""}${quality} · ${parts.join(" · ")}`;
  }

  // Per-O-event display multiplier (used to show each scene's O "worth" in the
  // performer score modal): 100% on the 1st O, easing down to 50% by the 10th,
  // holding at 50% through the 14th, then dropping to a flat 25% from the 15th on.
  function oEventMultiplier(i) { // i = 1-based position in the performer's O history
    if (i <= 1)  return 1;
    if (i <= 10) return 1 - (i-1)/9*0.5;
    if (i <= 14) return 0.5;
    return 0.25;
  }

  // ── Shared ranking builder (performers OR studios, any time scope) ─────────
  // scope = { type:"year", value:2025 } | { type:"month", value:"2025-06" } | { type:"all" }
  // getEntities(scene) returns an array of { id, name, image_path, favorite } —
  // scene.performers for the performer rankings, or [scene.studio] for studios.
  function oEventsInScope(history, scope) {
    const valid = (history||[]).filter(ts => !isNaN(new Date(ts).getTime()));
    if (scope.type === "all")   return valid;
    if (scope.type === "year")  return valid.filter(ts => getRomeParts(new Date(ts)).year === scope.value);
    if (scope.type === "month") return valid.filter(ts => { const p=getRomeParts(new Date(ts)); return `${p.year}-${String(p.month+1).padStart(2,"0")}`===scope.value; });
    return [];
  }

  function buildRanking(scenes, scope, getEntities) {
    const map = new Map();
    scenes.forEach(scene => {
      const eventsInScope = oEventsInScope(scene.o_history, scope);
      // Scenes with no o_history at all (older Stash versions) still count their
      // total o_counter toward "All Time" rankings, since there's no per-event
      // timestamp to bucket into a year/month.
      let oCount = eventsInScope.length;
      if (oCount === 0 && (!scene.o_history || !scene.o_history.length) && scope.type === "all" && scene.o_counter > 0) {
        oCount = scene.o_counter;
      }
      if (!oCount) return;
      const durMins = (scene.files && scene.files[0] && scene.files[0].duration) ? scene.files[0].duration / 60 : 0;
      const sceneRatingNorm = scene.rating100!=null ? scene.rating100/100 : 0.6;
      const qualityMins = durMins * sceneRatingNorm * oCount;
      const eventTimes = eventsInScope.length ? eventsInScope.map(ts=>new Date(ts).getTime()) : [Date.now()];
      const entities = getEntities(scene) || [];
      entities.forEach(ent => {
        if (!ent || !ent.id) return;
        if (!map.has(ent.id)) map.set(ent.id, { id:ent.id, name:ent.name||"Unknown", image_path:ent.image_path||null, oCount:0, sceneCount:0, playMins:0, qualityMins:0, ratingSum:0, ratingCount:0, isFavorite:false, scenes:[] });
        const s = map.get(ent.id);
        s.oCount += oCount; s.sceneCount += 1; s.playMins += durMins; s.qualityMins += qualityMins;
        if (scene.rating100!=null) { s.ratingSum += scene.rating100; s.ratingCount += 1; }
        if (ent.favorite) s.isFavorite = true;
        eventTimes.forEach(t => { s.scenes.push({ sceneId:scene.id, title:scene.title||"(Untitled scene)", rating100:scene.rating100, durMins, screenshot:(scene.paths&&scene.paths.screenshot)||null, firstO:t }); });
      });
    });
    return Array.from(map.values())
      .map(s => { const stats = { ...s, avgRating: s.ratingCount>0?s.ratingSum/s.ratingCount:0 }; return { ...stats, score:scorePodiumPerformer(stats), stats }; })
      .sort((a,b)=>b.score-a.score)
      .map((p,i)=>({ ...p, rank:i+1 }));
  }

  // Single shared fetch of all O'd scenes with everything the performer/studio
  // rankings need (performers + studio), used by PerformerPodium, MonthlyPodium,
  // and StudioPodium alike so the query is defined in exactly one place.
  async function fetchOScenesForRanking() {
    const data = await gqlQuery(`query {
      findScenes(scene_filter:{o_counter:{value:0,modifier:GREATER_THAN}} filter:{per_page:-1}) {
        scenes { id title o_history o_counter rating100 paths { screenshot } files { duration } performers { id name image_path favorite } studio { id name image_path } }
      }
    }`);
    return data.findScenes.scenes;
  }

  function PerformerScoreModal({ performer, onClose, onSelectScene, entityRoute, entityLabel, periodLabel }) {
    const { Link } = PluginApi.libraries.ReactRouterDOM;
    const route = entityRoute || "/performers";
    const label = entityLabel || "performer";
    const period = periodLabel || "this year";
    const b = scoreBreakdown(performer.stats);
    const fmtPts = n => Math.round(n*10)/10;
    const playTime = b.playMins>0 ? (()=>{ const h=Math.floor(b.playMins/60), m=Math.round(b.playMins%60); return h>0?`${h}h ${m}m`:`${m}m`; })() : "0m";
    const fmtMins = mins => { const h=Math.floor(mins/60), m=Math.round(mins%60); return h>0?`${h}h ${m}m`:`${m}m`; };
    const yearScenes = (performer.stats.scenes||[]).slice().sort((a,b2)=>a.firstO-b2.firstO);

    return h(Modal, { onClose, className:"stash-plus-score-modal" },
      h("div", { className:"stash-plus-score-header" },
        performer.image_path
          ? h("img", { className:"stash-plus-score-avatar", src:performer.image_path, alt:performer.name, onError:e=>e.target.style.display="none" })
          : h("div", { className:"podium-avatar-placeholder" }, "🎭"),
        h("div", null,
          h("h3", null, performer.name),
          h("div", { className:"stash-plus-score-rank" }, `Rank #${performer.rank} · ${performer.score} pts`)
        )
      ),
      h("table", { className:"stash-plus-score-table" },
        h("tbody", null,
          h("tr", null,
            h("td", null, "Volume (O's & scenes)"),
            h("td", null, `${b.oCount} O${b.oCount!==1?"s":""}, ${b.sceneCount} scene${b.sceneCount!==1?"s":""}`),
            h("td", { className:"stash-plus-score-pts" }, `+${fmtPts(b.volumeScore)}`)
          ),
          h("tr", null,
            h("td", null, "Watch time"),
            h("td", null, playTime),
            h("td", { className:"stash-plus-score-pts" }, `+${fmtPts(b.playScore)}`)
          ),
          h("tr", null,
            h("td", null, "Rating (multiplier only)"),
            h("td", null, b.hasRating ? `${(b.avgRating/10).toFixed(1)}/10 avg` : "Unrated (assumed 60%)"),
            h("td", { className:"stash-plus-score-pts" }, "—")
          ),
          h("tr", null,
            h("td", null, "Favorite bonus"),
            h("td", null, b.isFavorite ? "❤️ Yes" : "No"),
            h("td", { className:"stash-plus-score-pts" }, `+${fmtPts(b.favBonus)}`)
          ),
          h("tr", { className:"stash-plus-score-total" },
            h("td", null, "Total"),
            h("td", null, ""),
            h("td", { className:"stash-plus-score-pts" }, `${b.total} pts`)
          )
        )
      ),
      h("p", { className:"stash-plus-score-note" },
        "Volume is weighted by quality (rating), so a high O-count with a low rating scores lower than the same volume with a high rating."
      ),
      h(Link, { to:`${route}/${performer.id}`, className:"stash-plus-scene-open", onClick:onClose }, `View ${label} →`),
      yearScenes.length > 0 && h("div", { style:{ marginTop:"1rem" } },
        h("div", { style:{ fontWeight:600, marginBottom:"0.5rem" } }, `Scenes O'd ${period}`),
        (() => {
          // Each O event is worth a flat 100 points, scaled by that scene's OWN
          // rating (0-10) and eased down by its position in the performer's O
          // history via oEventMultiplier — so a later O on a great scene can still
          // outscore an early O on a mediocre one.
          return yearScenes.map((sc,i) => {
            const ratingNorm = sc.rating100!=null ? sc.rating100/100 : 0.6;
            const eventQualityMins = sc.durMins * ratingNorm;
            const playPart = b.qualityMins > 0 ? (eventQualityMins / b.qualityMins) * b.playScore : 0;
            const ratingOutOf10 = sc.rating100!=null ? sc.rating100/10 : 6;
            const multiplier = ratingOutOf10 * oEventMultiplier(i+1);
            const oPart    = 100 * multiplier;
            const fmtPt    = n => Math.round(n*10)/10;
            const total    = fmtPt(playPart + oPart);
            return h("div", {
                key:sc.sceneId+"-"+i,
                onClick:()=>onSelectScene(sc.sceneId),
                style:{ display:"flex", alignItems:"center", gap:"0.75rem", padding:"0.4rem 0", borderBottom:"1px solid rgba(255,255,255,0.06)", cursor:"pointer", fontSize:"0.85rem" },
              },
              sc.screenshot
                ? h("img", { src:sc.screenshot, alt:sc.title, style:{ width:"120px", height:"68px", objectFit:"cover", borderRadius:"4px", flexShrink:0 } })
                : h("div", { style:{ width:"120px", height:"68px", flexShrink:0, background:"rgba(255,255,255,0.08)", borderRadius:"4px" } }),
              h("span", { style:{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, sc.title),
              h("span", { style:{ opacity:0.75, whiteSpace:"nowrap", flexShrink:0, textAlign:"right" } },
                dateKey(new Date(sc.firstO)) + " · " + (sc.rating100!=null ? `${(sc.rating100/10).toFixed(1)}/10 · ` : "unrated · ") + fmtMins(sc.durMins),
                h("br"),
                h("span", { className:"stash-plus-score-pts" }, `≈+${total} pts`),
                h("div", { style:{ opacity:0.6, fontSize:"0.7rem", marginTop:"0.1rem" } }, `▶ ${fmtPt(playPart)} · 💦 ${fmtPt(oPart)} (×${multiplier.toFixed(2)})`)
              )
            );
          });
        })()
      )
    );
  }

  function PodiumBlock({ performers, onSelectPerformer, showStage, showReasons }) {
    const withStage = showStage !== false, withReasons = showReasons !== false;
    const order   = [performers[1], performers[0], performers[2]].filter(Boolean);
    const heights = [110, 150, 80];
    const medals  = ["🥈","🥇","🥉"];
    const colors  = ["#a8a8b3","#ffc850","#cd7f32"];
    return h("div", { className:"podium-wrap" },
      withStage && h("div", { className:"podium-stage" },
        order.map((p,i) =>
          h("div", { key:p.id, className:"podium-slot"+(p.rank===1?" podium-slot-first":""), onClick:()=>onSelectPerformer(p), role:"button", tabIndex:0, title:"View score breakdown" },
            h("div", { className:"podium-avatar-wrap" },
              p.image_path
                ? h("img", { className:"podium-avatar", src:p.image_path, alt:p.name, onError:e=>e.target.style.display="none" })
                : h("div", { className:"podium-avatar-placeholder" }, "🎭"),
              h("div", { className:"podium-medal" }, medals[i])
            ),
            h("div", { className:"podium-name" }, p.name),
            h("div", { className:"podium-platform", style:{ height:heights[i]+"px", background:colors[i] } },
              h("div", { className:"podium-rank" }, "#"+p.rank),
              h("div", { className:"podium-score"  }, p.score+" pts")
            )
          )
        )
      ),
      withReasons && h("div", { className:"podium-reasons" },
        performers.slice(0,3).map(p =>
          h("div", { key:p.id, className:"podium-reason-card", onClick:()=>onSelectPerformer(p), role:"button", tabIndex:0, title:"View score breakdown" },
            h("strong", null, p.name),
            h("p", null, explainScore(p.stats, p.rank))
          )
        )
      )
    );
  }

  function FullRanking({ performers, onSelectPerformer }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? performers : performers.slice(0, 10);
    return h("div", { className:"podium-full-list" },
      h("h3", null, "Full Ranking"),
      shown.map((p,i) =>
        h("div", { key:p.id, className:"podium-row", onClick:()=>onSelectPerformer({ ...p, rank:i+1 }), role:"button", tabIndex:0, title:"View score breakdown" },
          h("span", { className:"podium-row-rank" }, "#"+(i+1)),
          p.image_path
            ? h("img", { className:"podium-row-avatar", src:p.image_path, alt:p.name, onError:e=>e.target.style.display="none" })
            : h("div", { className:"podium-row-avatar podium-avatar-placeholder" }, "🎭"),
          h("div", { className:"podium-row-info" },
            h("span", { className:"podium-row-name" }, p.name),
            h("span", { className:"podium-row-reason" }, explainScore(p.stats, i+1))
          ),
          h("span", { className:"podium-row-score" }, p.score+" pts")
        )
      ),
      performers.length > 10 && h("button", { className:"podium-show-more", onClick:()=>setExpanded(!expanded) },
        expanded ? "Show less ▲" : `Show all ${performers.length} performers ▼`
      )
    );
  }

  // Reusable collapsible wrapper for stats sections. Persists open/closed
  // state per section (keyed by storageKey) so it survives page reloads.
  function CollapsibleSection({ title, storageKey, defaultOpen, children }) {
    const lsKey = storageKey ? "stashPlusCollapse:" + storageKey : null;
    const [open, setOpen] = useState(() => {
      if (!lsKey) return defaultOpen !== false;
      try {
        const v = localStorage.getItem(lsKey);
        return v === null ? (defaultOpen !== false) : v === "1";
      } catch (e) { return defaultOpen !== false; }
    });
    const toggle = () => setOpen(o => {
      const next = !o;
      try { if (lsKey) localStorage.setItem(lsKey, next ? "1" : "0"); } catch (e) {}
      return next;
    });
    return h("div", { className:"stash-plus-category" },
      h("div", { className:"stash-plus-collapsible-header", onClick:toggle, role:"button", tabIndex:0 },
        h("h2", null, title),
        h("span", { className:"stash-plus-collapse-chevron"+(open?"":" collapsed") }, "▾")
      ),
      open && children
    );
  }

  // Simple horizontal bar chart for the Diversity Breakdown stat — each row is
  // clickable (when it has performers behind it) to pop up who's in it.
  function DistributionBars({ items, onSelectBucket }) {
    const total = items.reduce((s,i)=>s+i.count, 0) || 1;
    const max = Math.max(1, ...items.map(i=>i.count));
    if (!items.length) return h("div", { style:{ opacity:0.5, fontSize:"0.82rem" } }, "No data yet.");
    return h("div", null,
      items.map(item => h("div", {
          key:item.label,
          onClick: () => (item.performers.length || item.selectable) && onSelectBucket(item),
          style:{ display:"flex", alignItems:"center", gap:"0.6rem", padding:"0.25rem 0.3rem", borderRadius:"4px", background: item.active ? "rgba(255,200,80,0.15)" : "transparent", cursor: (item.performers.length || item.selectable)?"pointer":"default" },
          title: item.selectable ? "Filter the ranking by this range" : (item.performers.length ? "View performers" : undefined),
        },
        h("div", { style:{ width:"92px", flexShrink:0, fontSize:"0.78rem", opacity:0.85, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, item.label),
        h("div", { style:{ flex:1, background:"rgba(255,255,255,0.06)", borderRadius:"4px", height:"12px", overflow:"hidden" } },
          h("div", { style:{ height:"100%", width:(item.count/max*100)+"%", background:"linear-gradient(90deg, #ffb347, #ffc850)" } })
        ),
        h("div", { style:{ width:"64px", flexShrink:0, textAlign:"right", fontSize:"0.75rem", opacity:0.7 } }, `${Math.round(item.count/total*100)}%`)
      ))
    );
  }

  // Search a single performer and show their O's, playtime, scenes added, and
  // average rating broken down by month.
  // Two-column variant of SceneListModal: splits scenes into "O Events" and
  // "Added Scenes" columns, each labeled, reusing the same simple row layout.
  function TwoColumnSceneModal({ heading, subheading, oScenes, addedScenes, onClose, onSelectScene }) {
    const fmtMins = mins => { const h2=Math.floor(mins/60), m=Math.round(mins%60); return h2>0?`${h2}h ${m}m`:`${m}m`; };
    const row = sc => h("div", {
        key:sc.id, onClick:()=>onSelectScene(sc.id),
        style:{ display:"flex", alignItems:"center", gap:"0.6rem", padding:"0.35rem 0", borderBottom:"1px solid rgba(255,255,255,0.06)", cursor:"pointer", fontSize:"0.82rem" },
      },
      sc.screenshot
        ? h("img", { src:sc.screenshot, alt:sc.title, style:{ width:"90px", height:"51px", objectFit:"cover", borderRadius:"4px", flexShrink:0 } })
        : h("div", { style:{ width:"90px", height:"51px", flexShrink:0, background:"rgba(255,255,255,0.08)", borderRadius:"4px" } }),
      h("div", { style:{ flex:1, minWidth:0 } },
        h("div", { style:{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, sc.title),
        h("div", { style:{ opacity:0.7, fontSize:"0.75rem", marginTop:"0.1rem" } },
          [sc.rating100!=null ? `${(sc.rating100/10).toFixed(1)}/10` : "unrated", sc.durMins ? fmtMins(sc.durMins) : null, sc.diffDaysLabel || null].filter(Boolean).join(" · ")
        )
      )
    );
    return h(Modal, { onClose },
      h("h3", { style:{ marginTop:0 } }, heading),
      subheading && h("p", { className:"stash-plus-score-note" }, subheading),
      h("div", { style:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1.25rem" } },
        h("div", null,
          h("div", { style:{ fontWeight:600, marginBottom:"0.5rem", opacity:0.8, fontSize:"0.85rem", textTransform:"uppercase", letterSpacing:"0.05em" } }, `💦 O Events (${oScenes.length})`),
          oScenes.length ? oScenes.map(row) : h("div", { style:{ opacity:0.5, fontSize:"0.85rem" } }, "None")
        ),
        h("div", null,
          h("div", { style:{ fontWeight:600, marginBottom:"0.5rem", opacity:0.8, fontSize:"0.85rem", textTransform:"uppercase", letterSpacing:"0.05em" } }, `➕ Added Scenes (${addedScenes.length})`),
          addedScenes.length ? addedScenes.map(row) : h("div", { style:{ opacity:0.5, fontSize:"0.85rem" } }, "None")
        )
      )
    );
  }

  function PerformerMonthlyStats() {
    const [query, setQuery]       = useState("");
    const [results, setResults]   = useState([]);
    const [selected, setSelected] = useState(null);
    const [state, setState]       = useState({ loading:false, error:null, months:[], heat:null });
    const [showAll, setShowAll]   = useState(false);
    const [selectedList, setSelectedList] = useState(null);
    const [selectedSceneId, setSelectedSceneId] = useState(null);
    const [heatYear, setHeatYear] = useState(null);
    const [dayList, setDayList] = useState(null);

    useEffect(() => {
      if (!query || query.trim().length < 2) { setResults([]); return; }
      let cancelled = false;
      const t = setTimeout(() => {
        gqlQuery(`query($q: String!) {
          findPerformers(performer_filter:{name:{value:$q, modifier:INCLUDES}} filter:{per_page:8}) {
            performers { id name image_path }
          }
        }`, { q: query.trim() })
          .then(d => { if (!cancelled) setResults(d.findPerformers.performers || []); })
          .catch(() => { if (!cancelled) setResults([]); });
      }, 300);
      return () => { cancelled = true; clearTimeout(t); };
    }, [query]);

    useEffect(() => {
      if (!selected) return;
      let cancelled = false;
      setState({ loading:true, error:null, months:[], heat:null }); setHeatYear(null);
      gqlQuery(`query($id: ID!) {
        findScenes(scene_filter:{performers:{value:[$id], modifier:INCLUDES}} filter:{per_page:-1}) {
          scenes { id title created_at o_history o_counter rating100 files { duration } paths { screenshot } performers { id name } }
        }
      }`, { id: selected.id }).then(data => {
        if (cancelled) return;
        const scenes = data.findScenes.scenes || [];
        const monthMap = new Map();
        const ensure = k => { if (!monthMap.has(k)) monthMap.set(k, { month:k, oCount:0, playMins:0, ratingSum:0, ratingCount:0, oScenes:[], addedScenes:[] }); return monthMap.get(k); };
        scenes.forEach(s => {
          const durMins = (s.files && s.files[0] && s.files[0].duration) ? s.files[0].duration/60 : 0;
          const screenshot = (s.paths && s.paths.screenshot) || null;
          const added = new Date(s.created_at);
          if (!isNaN(added.getTime())) {
            const am = ensure(`${added.getFullYear()}-${String(added.getMonth()+1).padStart(2,"0")}`);
            am.addedScenes.push({ id:s.id, title:s.title||"(Untitled scene)", screenshot, rating100:s.rating100, durMins, diffDaysLabel:dateKey(added) });
          }
          (s.o_history || []).forEach(ts => {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return;
            const m = ensure(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
            m.oCount += 1; m.playMins += durMins;
            if (s.rating100 != null) { m.ratingSum += s.rating100; m.ratingCount += 1; }
            m.oScenes.push({ id:s.id, title:s.title||"(Untitled scene)", screenshot, rating100:s.rating100, durMins, diffDaysLabel:dateKey(d) });
          });
        });
        const months = Array.from(monthMap.values()).sort((a,b)=>b.month.localeCompare(a.month));
        const dd = buildODayData(scenes);
        const heatYears = Array.from(new Set(Object.keys(dd).map(k=>Number(k.slice(0,4))))).sort((a,b)=>b-a);
        if (!cancelled) setState({ loading:false, error:null, months, heat:{ dayData:dd, years:heatYears } });
      }).catch(err => { if (!cancelled) setState({ loading:false, error:err.message, months:[], heat:null }); });
      return () => { cancelled = true; };
    }, [selected]);

    const fmtMins = mins => { const h2=Math.floor(mins/60), m=Math.round(mins%60); return h2>0?`${h2}h ${m}m`:`${m}m`; };
    const shown = showAll ? state.months : state.months.slice(0, 12);

    return h("div", null,
      h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } }, "Search a performer to see their O's, playtime, scenes added, and average rating by month."),
      h("input", {
        type:"text", value:query, placeholder:"Search performer…",
        onChange: e => { setQuery(e.target.value); setSelected(null); },
        className:"podium-year-select", style:{ width:"100%", maxWidth:"320px", marginBottom:"0.5rem" },
      }),
      !selected && results.length > 0 && h("div", { style:{ marginBottom:"1rem" } },
        results.map(p => h("div", {
            key:p.id,
            onClick: () => { setSelected(p); setQuery(p.name); setResults([]); },
            className:"podium-row",
          },
          p.image_path
            ? h("img", { src:p.image_path, alt:p.name, className:"podium-row-avatar" })
            : h("div", { className:"podium-row-avatar podium-avatar-placeholder" }, "🎭"),
          h("span", null, p.name)
        ))
      ),
      selected && h("div", { style:{ display:"flex", alignItems:"center", gap:"0.6rem", marginBottom:"1rem" } },
        selected.image_path
          ? h("img", { src:selected.image_path, alt:selected.name, className:"podium-row-avatar" })
          : h("div", { className:"podium-row-avatar podium-avatar-placeholder" }, "🎭"),
        h("strong", null, selected.name)
      ),
      selected && state.heat && state.heat.years.length > 0 && h("div", { style:{ marginBottom:"1.5rem" } },
        h("div", { style:{ fontWeight:600, marginBottom:"0.5rem" } }, `🗓️ ${selected.name} — Yearly Heatmap`),
        h(YearHeatmap, {
          heatmap: state.heat, year: heatYear, onYearChange: setHeatYear,
          onSelectDay: (key, entry) => setDayList(dayListPayload(key, entry)),
        })
      ),
      state.loading && h("div", { className:"stash-plus-loading" }, "Loading performer history…"),
      state.error   && h("div", { className:"stash-plus-error"   }, "Error: "+state.error),
      !state.loading && selected && state.months.length===0 && h("div", { className:"stash-plus-loading" }, "No O's or scenes found for this performer."),
      shown.length > 0 && h("table", { className:"stash-plus-score-table" },
        h("thead", null,
          h("tr", null,
            h("td", null, h("strong", null, "Month")),
            h("td", null, h("strong", null, "O's")),
            h("td", null, h("strong", null, "Playtime")),
            h("td", null, h("strong", null, "Scenes Added")),
            h("td", null, h("strong", null, "Avg Rating"))
          )
        ),
        h("tbody", null,
          shown.map(m => h("tr", { key:m.month, className:"clickable-row", onClick:()=>setSelectedList({ heading:`🔎 ${selected.name} — ${monthLabel(m.month)}`, oScenes:m.oScenes, addedScenes:m.addedScenes }), style:{ cursor:"pointer" } },
            h("td", null, monthLabel(m.month)),
            h("td", null, m.oCount),
            h("td", null, fmtMins(m.playMins)),
            h("td", null, m.addedScenes.length),
            h("td", null, m.ratingCount>0 ? (m.ratingSum/m.ratingCount/10).toFixed(1)+"/10" : "—")
          ))
        )
      ),
      state.months.length > 12 && h("button", { className:"podium-show-more", onClick:()=>setShowAll(!showAll) },
        showAll ? "Show less ▲" : `Show all ${state.months.length} months ▼`
      ),
      selectedList && h(TwoColumnSceneModal, { heading:selectedList.heading, oScenes:selectedList.oScenes, addedScenes:selectedList.addedScenes, onClose:()=>setSelectedList(null), onSelectScene:(sid)=>{ setSelectedList(null); setSelectedSceneId(sid); } }),
      dayList && h(SceneListModal, { heading:dayList.heading, subheading:dayList.subheading, scenes:dayList.scenes, onClose:()=>setDayList(null), onSelectScene:(sid)=>{ setDayList(null); setSelectedSceneId(sid); } }),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:()=>setSelectedSceneId(null) })
    );
  }

  // ── Shared calendar pieces ────────────────────────────────────────────────
  const heatColor = count => {
    if (!count) return "rgba(255,255,255,0.06)";
    if (count === 1) return "#3ba55d";
    if (count === 2) return "#e6c62c";
    if (count === 3) return "#d94f4f";
    if (count === 4) return "#9b59d0";
    return "#000000";
  };

  // scenes -> { "YYYY-MM-DD": { count, scenes:[...] } } (Rome calendar days)
  function buildODayData(scenes) {
    const dayData = {};
    scenes.forEach(s => {
      const info = {
        id: s.id, title: s.title || "(Untitled scene)",
        screenshot: (s.paths && s.paths.screenshot) || null,
        rating100: s.rating100,
        durMins: (s.files && s.files[0] && s.files[0].duration) ? s.files[0].duration / 60 : 0,
        oCounter: s.o_counter || 0,
        performerNames: (s.performers || []).map(p => p.name).filter(Boolean),
      };
      (s.o_history || []).forEach(ts => {
        const dt = new Date(ts);
        if (isNaN(dt.getTime())) return;
        const k = dateKey(dt);
        if (!dayData[k]) dayData[k] = { count: 0, scenes: [] };
        dayData[k].count++;
        dayData[k].scenes.push({ ...info, t: dt.getTime() });
      });
    });
    return dayData;
  }

  // Reads O votes/comments from the stashOratings plugin (null if it isn't loaded).
  async function loadORatingMaps() {
    if (!window.stashORatings) return null;
    try {
      const [ratings, comments] = await Promise.all([window.stashORatings.getAll(), window.stashORatings.getComments()]);
      return { ratings, comments };
    } catch (e) { return null; }
  }

  // Attaches each O event's own vote and comment to the scene rows of a day map.
  function enrichDayData(dayData, ratings, comments) {
    const out = {};
    Object.keys(dayData).forEach(k => {
      out[k] = { ...dayData[k], scenes: dayData[k].scenes.map(sc => {
        const key = `${sc.id}|${sc.t}`;
        return { ...sc, oRating100: ratings[key] == null ? null : ratings[key], oComment: comments[key] || null };
      }) };
    });
    return out;
  }

  // Makes a month <input> open its picker when clicked anywhere, not just on the icon.
  function openMonthPicker(e) { try { e.currentTarget.showPicker(); } catch (err) {} }

  // Payload for SceneListModal when a day is clicked
  function dayListPayload(key, entry) {
    const names = [...new Set(entry.scenes.flatMap(s => s.performerNames || []))];
    return {
      heading: `🗓️ ${key}`,
      subheading: `${entry.count} O${entry.count !== 1 ? "s" : ""} logged.` + (names.length ? ` Performers: ${names.join(", ")}.` : ""),
      scenes: entry.scenes,
    };
  }

  // One month, Monday-first, only that month's real days.
  function MonthGrid({ year, month, dayData, onSelectDay, cell, showTotal }) {
    const size = cell || 24;
    const big = size >= 40;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startPad = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = new Array(startPad).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    let monthTotal = 0, totalSpan = 1;
    if (showTotal) {
      for (let d = 1; d <= daysInMonth; d++) {
        const e = dayData[`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`];
        if (e) monthTotal += e.count;
      }
      const col = cells.length % 7;           // column the cell right after the last day lands in
      totalSpan = col === 0 ? 7 : 7 - col;    // fill the rest of that row (new row if the 1 was a Sunday)
      cells.push("TOTAL");
    } else {
      while (cells.length % 7) cells.push(null);
    }

    return h("div", { style: { display: "grid", gridTemplateColumns: `repeat(7, ${size}px)`, gap: "4px", width: "max-content" } },
      ["M","T","W","T","F","S","S"].map((l, i) =>
        h("div", { key: "h"+i, style: { textAlign: "center", fontSize: "0.65rem", opacity: 0.5 } }, l)),
      cells.map((d, i) => {
        if (d === null) return h("div", { key: "p"+i, style: { width: size+"px", height: size+"px" } });
        if (d === "TOTAL") return h("div", {
          key: "total",
          title: `${monthTotal} O${monthTotal !== 1 ? "s" : ""} this month`,
          style: { gridColumn: `span ${totalSpan}`, height: size+"px", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", fontWeight: 700, fontSize: "0.9rem", color: "#ffc850" },
        }, `Σ 💦 ${monthTotal}`);
        const key = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const entry = dayData[key];
        const count = entry ? entry.count : 0;
        return h("div", {
          key,
          title: `${key} — ${count} O${count !== 1 ? "s" : ""}`,
          onClick: () => count > 0 && onSelectDay(key, entry),
          style: {
            width: size+"px", height: size+"px", borderRadius: "3px", background: heatColor(count),
            cursor: count > 0 ? "pointer" : "default",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            fontSize: big ? "0.8rem" : "0.6rem", lineHeight: 1.1,
          },
        },
          h("span", { style: { opacity: count ? 0.9 : 0.45 } }, d),
          big && count > 0 && h("span", { style: { fontWeight: 700 } }, `💦${count}`)
        );
      })
    );
  }

  function YearHeatmap({ heatmap, year, onYearChange, onSelectDay }) {
    const selYear = year || heatmap.years[0] || getRomeToday().year;
    return h(React.Fragment, null,
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" } },
        h("p", { className: "stash-plus-score-note", style: { margin: 0 } }, "Each square is a day; color = number of O's. Click a day to see its scenes."),
        heatmap.years.length > 1 && h("select", { value: selYear, onChange: e => onYearChange(Number(e.target.value)), className: "podium-year-select" },
          heatmap.years.map(y => h("option", { key: y, value: y }, y)))
      ),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "1.25rem" } },
        MONTH_NAMES.map((name, m) => h("div", { key: m },
          h("div", { style: { fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.4rem" } }, name),
          h(MonthGrid, { year: selYear, month: m, dayData: heatmap.dayData, cell: 24, onSelectDay })
        ))
      )
    );
  }

  function StatsPage() {
    const [state, setState] = useState({ loading:true, error:null, data:null });
    const [showAllDays, setShowAllDays] = useState(false);
    const [yearFilter, setYearFilter] = useState("all");
    const [selectedList, setSelectedList] = useState(null); // { heading, subheading, scenes }
    const [selectedSceneId, setSelectedSceneId] = useState(null);
    const [showAllRewatch, setShowAllRewatch] = useState(false);
    const [heatYear, setHeatYear] = useState(null);
    const [selectedBucket, setSelectedBucket] = useState(null); // { heading, performers }
    const [selectedBucketPerformerId, setSelectedBucketPerformerId] = useState(null);

    useEffect(() => {
      let cancelled = false;
      setState({ loading:true, error:null, data:null });

      gqlQuery(`query {
        findScenes(filter:{per_page:-1}) {
          scenes { id title created_at o_history o_counter rating100 files { duration } paths { screenshot } performers { id name favorite image_path hair_color ethnicity country height_cm weight birthdate } }
        }
      }`).then(data => {
        if (cancelled) return;
        const scenes = data.findScenes.scenes || [];
        const sceneInfo = s => ({
          id: s.id, title: s.title || "(Untitled scene)",
          screenshot: (s.paths && s.paths.screenshot) || null,
          rating100: s.rating100,
          durMins: (s.files && s.files[0] && s.files[0].duration) ? s.files[0].duration/60 : 0,
          oCounter: s.o_counter || 0,
          performerNames: (s.performers||[]).map(p=>p.name).filter(Boolean),
        });

        // Library growth: group scenes by the day they were added
        const dayMap = new Map();
        scenes.forEach(s => {
          const d = new Date(s.created_at);
          if (isNaN(d.getTime())) return;
          const k = dateKey(d);
          if (!dayMap.has(k)) dayMap.set(k, { date:k, year:d.getFullYear(), scenes:[] });
          dayMap.get(k).scenes.push(sceneInfo(s));
        });
        const growthDays = Array.from(dayMap.values()).sort((a,b)=>b.date.localeCompare(a.date));
        const years = [...new Set(growthDays.map(d=>d.year))].sort((a,b)=>b-a);

        // Time from a scene being added to its first O
        const gaps = [];
        scenes.forEach(s => {
          const hist = s.o_history || [];
          if (!hist.length) return;
          const created = new Date(s.created_at);
          if (isNaN(created.getTime())) return;
          const times = hist.map(ts=>new Date(ts)).filter(dt=>!isNaN(dt.getTime())).map(dt=>dt.getTime());
          if (!times.length) return;
          const diffDays = (Math.min(...times) - created.getTime()) / 86400000;
          if (diffDays >= 0) gaps.push({ ...sceneInfo(s), diffDays });
        });
        gaps.sort((a,b)=>a.diffDays-b.diffDays);
        let timeToO = null;
        if (gaps.length) {
          const buckets = { sameDay:[], withinWeek:[], withinMonth:[], withinYear:[], overYear:[] };
          gaps.forEach(g => {
            if (g.diffDays < 1) buckets.sameDay.push(g);
            else if (g.diffDays < 7) buckets.withinWeek.push(g);
            else if (g.diffDays < 30) buckets.withinMonth.push(g);
            else if (g.diffDays < 365) buckets.withinYear.push(g);
            else buckets.overYear.push(g);
          });
          timeToO = {
            count: gaps.length,
            avg: gaps.reduce((s,g)=>s+g.diffDays,0) / gaps.length,
            median: gaps[Math.floor(gaps.length/2)].diffDays,
            fastest: gaps[0],
            slowest: gaps[gaps.length-1],
            buckets,
          };
        }

        // Streaks: consecutive calendar days with at least one O. "Day streak" counts
        // days; "O streak" counts total O events across that same run of days (so a
        // short run with lots of O's per day can outscore a longer, sparser run).
        const oDayMap = new Map(); // dateKey -> { count, scenes:[] }
        scenes.forEach(s => {
          const hist = s.o_history || [];
          if (!hist.length) return;
          const info = sceneInfo(s);
          hist.forEach(ts => {
            const dt = new Date(ts);
            if (isNaN(dt.getTime())) return;
            const k = dateKey(dt);
            if (!oDayMap.has(k)) oDayMap.set(k, { count:0, scenes:[] });
            const entry = oDayMap.get(k);
            entry.count++;
            entry.scenes.push(info);
          });
        });
        const sortedDayKeys = Array.from(oDayMap.keys()).sort();
        const runs = [];
        sortedDayKeys.forEach((k,i) => {
          if (i===0 || (Date.parse(k) - Date.parse(sortedDayKeys[i-1])) !== 86400000) runs.push({ days:[k] });
          else runs[runs.length-1].days.push(k);
        });
        const runInfo = run => {
          const oCount = run.days.reduce((sum,d)=>sum+oDayMap.get(d).count, 0);
          const runScenes = run.days.flatMap(d => oDayMap.get(d).scenes.map(sc => ({ ...sc, diffDaysLabel:d })));
          return { dayCount: run.days.length, oCount, scenes: runScenes };
        };
        let streaks = null;
        if (runs.length) {
          const longestDayStreak = runs.reduce((best,r)=> (!best || r.days.length > best.days.length) ? r : best, null);
          const longestOStreak   = runs.reduce((best,r)=> (!best || runInfo(r).oCount > runInfo(best).oCount) ? r : best, null);
          const lastRun = runs[runs.length-1];
          const todayKey = dateKey(new Date());
          const isCurrent = lastRun.days[lastRun.days.length-1] === todayKey;
          streaks = {
            longestDayStreak: runInfo(longestDayStreak),
            longestOStreak: runInfo(longestOStreak),
            currentDayStreak: isCurrent ? runInfo(lastRun) : { dayCount:0, oCount:0, scenes:[] },
            currentOStreak: isCurrent ? runInfo(lastRun) : { dayCount:0, oCount:0, scenes:[] },
          };
        }

        // Rewatch ratio: for each O event, is it a scene's first-ever O (fresh) or a
        // later O on a scene already O'd before (rewatch)? Bucketed by the month the
        // event happened in.
        const rewatchMonthMap = new Map();
        scenes.forEach(s => {
          const info = sceneInfo(s);
          const hist = (s.o_history||[]).map(ts=>new Date(ts)).filter(dt=>!isNaN(dt.getTime())).sort((a,b)=>a-b);
          hist.forEach((d,i) => {
            const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
            if (!rewatchMonthMap.has(k)) rewatchMonthMap.set(k, { month:k, total:0, rewatch:0, scenes:[] });
            const m = rewatchMonthMap.get(k);
            m.total += 1;
            if (i > 0) m.rewatch += 1;
            m.scenes.push({ ...info, diffDaysLabel: i>0 ? "Rewatch" : "First O" });
          });
        });
        const rewatchTrend = Array.from(rewatchMonthMap.values()).sort((a,b)=>b.month.localeCompare(a.month));

        // Yearly O heatmap (GitHub-contribution-graph style): reuses the per-day
        // counts/scenes already built above for the streaks calculation.
        const heatmapDayData = {};
        oDayMap.forEach((v,k) => { heatmapDayData[k] = v; });
        const heatmapYears = Array.from(new Set(Array.from(oDayMap.keys()).map(k=>Number(k.slice(0,4))))).sort((a,b)=>b-a);
        const heatmap = { dayData: heatmapDayData, years: heatmapYears, max: Math.max(1, ...Array.from(oDayMap.values()).map(v=>v.count)) };

        // Hour-of-day O heatmap: every O event bucketed by the hour it happened in
        // (Rome calendar), e.g. how many O's fell between 14:00-15:00 vs 23:00-00:00.
        const hourBuckets = Array.from({ length:24 }, (_,h) => ({ hour:h, count:0, scenes:[] }));
        scenes.forEach(s => {
          const hist = s.o_history || [];
          if (!hist.length) return;
          const info = sceneInfo(s);
          hist.forEach(ts => {
            const dt = new Date(ts);
            if (isNaN(dt.getTime())) return;
            const hr = getRomeParts(dt).hour;
            hourBuckets[hr].count++;
            hourBuckets[hr].scenes.push({ ...info, diffDaysLabel: dateKey(dt) });
          });
        });
        const hourHeatmap = { hours: hourBuckets, max: Math.max(1, ...hourBuckets.map(b=>b.count)) };

        // Diversity breakdown: for every O'd scene, attribute its O-weight (O
        // events if we have history, else the scene's o_counter) to each of its
        // performers' hair colour / ethnicity / country / age / height / weight
        // bucket — so the chart reflects how many O's actually went to each
        // group, not just how many performers happen to exist in each one.
        const bump = (map, key, p, weight) => {
          if (!key) return;
          if (!map.has(key)) map.set(key, { count:0, performers:new Map() });
          const entry = map.get(key);
          entry.count += weight;
          if (!entry.performers.has(p.id)) entry.performers.set(p.id, { performerId:p.id, performerName:p.name||"Unknown", image_path:p.image_path||null, oCount:0 });
          entry.performers.get(p.id).oCount += weight;
        };
        const ageBucketLabel = age => age<25?"18-24":age<30?"25-29":age<35?"30-34":age<40?"35-39":age<45?"40-44":age<50?"45-49":age<60?"50-59":"60+";
        const heightBucketLabel = cm => cm<155?"<155cm":cm<160?"155-159cm":cm<165?"160-164cm":cm<170?"165-169cm":cm<175?"170-174cm":cm<180?"175-179cm":cm<185?"180-184cm":cm<190?"185-189cm":"190cm+";
        const weightBucketLabel = kg => kg<50?"<50kg":kg<60?"50-59kg":kg<70?"60-69kg":kg<80?"70-79kg":kg<90?"80-89kg":kg<100?"90-99kg":"100kg+";

        const hairMap = new Map(), ethMap = new Map(), countryMap = new Map(), ageMap = new Map(), heightMap = new Map(), weightMap = new Map();
        scenes.forEach(s => {
          const hist = s.o_history || [];
          const weight = hist.length>0 ? hist.length : (s.o_counter||0);
          if (!weight) return;
          (s.performers||[]).forEach(p => {
            bump(hairMap, (p.hair_color||"").trim() || "Unspecified", p, weight);
            bump(ethMap, (p.ethnicity||"").trim() || "Unspecified", p, weight);
            bump(countryMap, (p.country||"").trim() || "Unspecified", p, weight);
            const age = getAge(p.birthdate);
            if (age!=null) bump(ageMap, ageBucketLabel(age), p, weight);
            const hCm = Number(p.height_cm)||0;
            if (hCm>0) bump(heightMap, heightBucketLabel(hCm), p, weight);
            const wKg = Number(p.weight)||0;
            if (wKg>0) bump(weightMap, weightBucketLabel(wKg), p, weight);
          });
        });
        const toItems = map => Array.from(map.entries()).map(([label,e]) => ({ label, count:e.count, performers:Array.from(e.performers.values()).sort((a,b)=>b.oCount-a.oCount) }));
        const byCountDesc = arr => arr.slice().sort((a,b)=>b.count-a.count);
        const capWithOther = (arr, n) => {
          const sorted = byCountDesc(arr);
          if (sorted.length <= n) return sorted;
          const kept = sorted.slice(0, n);
          const rest = sorted.slice(n);
          const otherCount = rest.reduce((s,x)=>s+x.count, 0);
          const otherPerformers = rest.flatMap(x=>x.performers).sort((a,b)=>b.oCount-a.oCount);
          return [...kept, { label:"Other", count:otherCount, performers:otherPerformers }];
        };
        const inOrder = (map, order) => order.map(label => { const e = map.get(label); return e ? { label, count:e.count, performers:Array.from(e.performers.values()).sort((a,b)=>b.oCount-a.oCount) } : null; }).filter(Boolean);

        const diversity = {
          hair:    byCountDesc(toItems(hairMap)),
          ethnicity: byCountDesc(toItems(ethMap)),
          country: capWithOther(toItems(countryMap), 8),
          age:     inOrder(ageMap, ["18-24","25-29","30-34","35-39","40-44","45-49","50-59","60+"]),
          height:  inOrder(heightMap, ["<155cm","155-159cm","160-164cm","165-169cm","170-174cm","175-179cm","180-184cm","185-189cm","190cm+"]),
          weight:  inOrder(weightMap, ["<50kg","50-59kg","60-69kg","70-79kg","80-89kg","90-99kg","100kg+"]),
        };

        setState({ loading:false, error:null, data:{ growthDays, years, timeToO, streaks, rewatchTrend, heatmap, hourHeatmap, diversity } });
      }).catch(err => { if (!cancelled) setState({ loading:false, error:err.message, data:null }); });

      return () => { cancelled = true; };
    }, []);

    if (state.loading) return h("div", { className:"stash-plus-loading" }, "Crunching library stats…");
    if (state.error)   return h("div", { className:"stash-plus-error" }, "Error: "+state.error);

    const { growthDays, years, timeToO, streaks, rewatchTrend, heatmap, hourHeatmap, diversity } = state.data;
    const filteredDays = yearFilter==="all" ? growthDays : growthDays.filter(d=>String(d.year)===yearFilter);
    const maxDayCount = filteredDays.reduce((m,day)=>Math.max(m,day.scenes.length), 0);
    const shownDays = showAllDays ? filteredDays : filteredDays.slice(0, 30);
    const fmtDays = n => n < 1 ? "same day" : n < 2 ? "1 day" : `${Math.round(n*10)/10} days`;
    const fmtMins = mins => { const h2=Math.floor(mins/60), m=Math.round(mins%60); return h2>0?`${h2}h ${m}m`:`${m}m`; };
    const withGapLabels = list => list.map(g => ({ ...g, diffDaysLabel: fmtDays(g.diffDays) }));

    const bucketRow = (label, key, note) => h("tr", { onClick:()=>timeToO.buckets[key].length && setSelectedList({ heading:label, subheading:note, scenes:withGapLabels(timeToO.buckets[key]) }), style:{ cursor: timeToO.buckets[key].length ? "pointer" : "default" } },
      h("td", null, label), h("td", { className:"stash-plus-score-pts" }, timeToO.buckets[key].length)
    );

    return h("div", null,
      h(CollapsibleSection, { title:"📈 Library Growth", storageKey:"libraryGrowth" },
        h("div", { style:{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.5rem", marginBottom:"0.5rem" } },
          h("p", { className:"stash-plus-score-note", style:{ margin:0 } }, `Scenes added on ${filteredDays.length} distinct day${filteredDays.length!==1?"s":""}.`),
          years.length > 1 && h("select", {
            value: yearFilter, onChange: e=>{ setYearFilter(e.target.value); setShowAllDays(false); },
            className: "podium-year-select",
          },
            h("option", { value:"all" }, "All years"),
            years.map(y => h("option", { key:y, value:String(y) }, y))
          )
        ),
        shownDays.map(day =>
          h("div", { key:day.date, className:"podium-row", onClick:()=>setSelectedList({ heading:`📅 ${day.date}`, subheading:`${day.scenes.length} scene${day.scenes.length!==1?"s":""} added this day.`, scenes:day.scenes }) },
            h("span", { className:"podium-row-rank" }, day.scenes.length),
            h("div", { style:{ flex:1, background:"rgba(255,255,255,0.06)", borderRadius:"4px", overflow:"hidden", height:"10px", margin:"0 0.75rem" } },
              h("div", { style:{ height:"100%", width:(maxDayCount?Math.max(4,(day.scenes.length/maxDayCount)*100):0)+"%", background:"linear-gradient(90deg, #ffb347, #ffc850)" } })
            ),
            h("span", { style:{ fontSize:"0.85rem", opacity:0.8, flexShrink:0 } }, day.date)
          )
        ),
        filteredDays.length > 30 && h("button", { className:"podium-show-more", onClick:()=>setShowAllDays(!showAllDays) },
          showAllDays ? "Show less ▲" : `Show all ${filteredDays.length} days ▼`
        )
      ),
      timeToO && h(CollapsibleSection, { title:"⏱️ Time to First O", storageKey:"timeToFirstO" },
        h("div", { className:"stash-plus-grid" },
          h("div", { className:"stash-plus-card" },
            h("div", { className:"stash-plus-card-icon" }, "📊"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Average"),
              h("div", { className:"stash-plus-card-desc" }, fmtDays(timeToO.avg))
            )
          ),
          h("div", { className:"stash-plus-card" },
            h("div", { className:"stash-plus-card-icon" }, "📐"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Median"),
              h("div", { className:"stash-plus-card-desc" }, fmtDays(timeToO.median))
            )
          ),
          h("div", { className:"stash-plus-card clickable", onClick:()=>setSelectedSceneId(timeToO.fastest.id) },
            h("div", { className:"stash-plus-card-icon" }, "⚡"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Fastest"),
              h("div", { className:"stash-plus-card-desc" }, `${timeToO.fastest.title} — ${fmtDays(timeToO.fastest.diffDays)}`)
            )
          ),
          h("div", { className:"stash-plus-card clickable", onClick:()=>setSelectedSceneId(timeToO.slowest.id) },
            h("div", { className:"stash-plus-card-icon" }, "🐌"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Slowest"),
              h("div", { className:"stash-plus-card-desc" }, `${timeToO.slowest.title} — ${fmtDays(timeToO.slowest.diffDays)}`)
            )
          )
        ),
        h("table", { className:"stash-plus-score-table", style:{ marginTop:"1rem" } },
          h("tbody", null,
            bucketRow("Same day", "sameDay"),
            bucketRow("Within a week", "withinWeek"),
            bucketRow("Within a month", "withinMonth"),
            bucketRow("Within a year", "withinYear"),
            bucketRow("Over a year", "overYear")
          )
        )
      ),
      streaks && h(CollapsibleSection, { title:"🔥 Streaks", storageKey:"streaks" },
        h("div", { className:"stash-plus-grid" },
          h("div", { className:"stash-plus-card clickable", onClick:()=>setSelectedList({ heading:"🔥 Longest Day Streak", subheading:`${streaks.longestDayStreak.dayCount} consecutive day${streaks.longestDayStreak.dayCount!==1?"s":""} with at least one O.`, scenes:streaks.longestDayStreak.scenes }) },
            h("div", { className:"stash-plus-card-icon" }, "📆"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Longest Day Streak"),
              h("div", { className:"stash-plus-card-desc" }, `${streaks.longestDayStreak.dayCount} day${streaks.longestDayStreak.dayCount!==1?"s":""}`)
            )
          ),
          h("div", { className:"stash-plus-card clickable", onClick:()=>setSelectedList({ heading:"🔥 Longest O Streak", subheading:`${streaks.longestOStreak.oCount} O's across a consecutive-day run.`, scenes:streaks.longestOStreak.scenes }) },
            h("div", { className:"stash-plus-card-icon" }, "💦" ),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Longest O Streak"),
              h("div", { className:"stash-plus-card-desc" }, `${streaks.longestOStreak.oCount} O's`)
            )
          ),
          h("div", { className:"stash-plus-card"+(streaks.currentDayStreak.dayCount?" clickable":""), onClick:()=>streaks.currentDayStreak.dayCount && setSelectedList({ heading:"⏳ Current Day Streak", subheading:`${streaks.currentDayStreak.dayCount} consecutive day${streaks.currentDayStreak.dayCount!==1?"s":""} with at least one O, as of today.`, scenes:streaks.currentDayStreak.scenes }) },
            h("div", { className:"stash-plus-card-icon" }, "⏳"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Current Day Streak"),
              h("div", { className:"stash-plus-card-desc" }, streaks.currentDayStreak.dayCount ? `${streaks.currentDayStreak.dayCount} day${streaks.currentDayStreak.dayCount!==1?"s":""}` : "No O today")
            )
          ),
          h("div", { className:"stash-plus-card"+(streaks.currentOStreak.oCount?" clickable":""), onClick:()=>streaks.currentOStreak.oCount && setSelectedList({ heading:"⏳ Current O Streak", subheading:`${streaks.currentOStreak.oCount} O's across today's active streak.`, scenes:streaks.currentOStreak.scenes }) },
            h("div", { className:"stash-plus-card-icon" }, "⚡"),
            h("div", { className:"stash-plus-card-body" },
              h("div", { className:"stash-plus-card-title" }, "Current O Streak"),
              h("div", { className:"stash-plus-card-desc" }, streaks.currentOStreak.oCount ? `${streaks.currentOStreak.oCount} O's` : "No O today")
            )
          )
        )
      ),
      heatmap && h(CollapsibleSection, { title:"🗓️ Yearly O Heatmap", storageKey:"heatmap", defaultOpen:false },
        h(YearHeatmap, {
          heatmap, year: heatYear, onYearChange: setHeatYear,
          onSelectDay: (key, entry) => setSelectedList(dayListPayload(key, entry)),
        })
      ),
      hourHeatmap && h(CollapsibleSection, { title:"🕐 Hour of Day Heatmap", storageKey:"hourHeatmap", defaultOpen:false },
        (() => {
          // Green (few O's) → dark red (many O's), scaled relative to this
          // library's busiest hour so the gradient always uses the full range.
          const hourColor = count => {
            if (!count) return "rgba(255,255,255,0.06)";
            const ratio = Math.min(1, count / hourHeatmap.max);
            const hue = 120 - ratio*120;   // 120=green → 0=red
            const light = 48 - ratio*23;   // lighter for low counts, darker (deeper red) for high
            return `hsl(${hue}, 72%, ${light}%)`;
          };
          const fmtHour = h2 => `${String(h2).padStart(2,"0")}:00`;
          return h(React.Fragment, null,
            h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } }, "How your O's are distributed across the hours of the day. Click an hour to see its scenes."),
            h("div", { style:{ display:"grid", gridTemplateColumns:"repeat(12, 1fr)", gap:"4px", marginBottom:"0.75rem" } },
              hourHeatmap.hours.map(b =>
                h("div", {
                    key:b.hour,
                    title:`${fmtHour(b.hour)}-${fmtHour((b.hour+1)%24)} — ${b.count} O${b.count!==1?"s":""}`,
                    onClick: () => b.count>0 && setSelectedList({ heading:`🕐 ${fmtHour(b.hour)}-${fmtHour((b.hour+1)%24)}`, subheading:`${b.count} O${b.count!==1?"s":""} logged in this hour of the day, across all days.`, scenes:b.scenes }),
                    style:{
                      background:hourColor(b.count), borderRadius:"6px", padding:"0.5rem 0.25rem",
                      textAlign:"center", cursor: b.count>0?"pointer":"default",
                      display:"flex", flexDirection:"column", alignItems:"center", gap:"0.15rem",
                    },
                  },
                  h("div", { style:{ fontSize:"0.7rem", opacity:0.85, fontWeight:600 } }, b.hour),
                  h("div", { style:{ fontSize:"0.7rem", opacity:0.85 } }, b.count)
                )
              )
            ),
            h("div", { style:{ display:"flex", alignItems:"center", gap:"0.5rem", fontSize:"0.75rem", opacity:0.7 } },
              h("span", null, "Fewer"),
              h("div", { style:{ flex:1, height:"10px", borderRadius:"5px",
                background:"linear-gradient(90deg, hsl(120,72%,48%), hsl(90,72%,42%), hsl(60,72%,36%), hsl(30,72%,30%), hsl(0,72%,25%))" } }),
              h("span", null, "More")
            )
          );
        })()
      ),
      rewatchTrend && rewatchTrend.length > 0 && h(CollapsibleSection, { title:"🔁 Rewatch Ratio Trend", storageKey:"rewatchTrend", defaultOpen:false },
        h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } }, "Share of each month's O's that were repeat O's on a scene you'd already O'd before, versus a scene's first-ever O."),
        h("table", { className:"stash-plus-score-table" },
          h("tbody", null,
            (showAllRewatch ? rewatchTrend : rewatchTrend.slice(0,12)).map(m =>
              h("tr", { key:m.month, className:"clickable-row", onClick:()=>setSelectedList({ heading:`🔁 ${monthLabel(m.month)}`, subheading:`${m.total} O's logged (${m.rewatch} rewatch, ${m.total-m.rewatch} first-time).`, scenes:m.scenes }), style:{ cursor:"pointer" } },
                h("td", null, monthLabel(m.month)),
                h("td", null, `${m.rewatch} / ${m.total}`),
                h("td", { className:"stash-plus-score-pts" }, `${Math.round((m.rewatch/m.total)*100)}%`)
              )
            )
          )
        ),
        rewatchTrend.length > 12 && h("button", { className:"podium-show-more", onClick:()=>setShowAllRewatch(!showAllRewatch) },
          showAllRewatch ? "Show less ▲" : `Show all ${rewatchTrend.length} months ▼`
        )
      ),
      h(CollapsibleSection, { title:"🔎 Performer Monthly Analysis", storageKey:"performerMonthly", defaultOpen:false },
        h(PerformerMonthlyStats, null)
      ),
      diversity && h(CollapsibleSection, { title:"🌈 Diversity Breakdown", storageKey:"diversity", defaultOpen:false },
        h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } }, "Where your O's have actually gone, by performer hair colour, ethnicity, country, age, height, and weight. Click any bar to see who's behind it."),
        h("div", { style:{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:"1.5rem" } },
          [
            ["💇 Hair Colour", diversity.hair],
            ["🌍 Ethnicity", diversity.ethnicity],
            ["🗺️ Country", diversity.country],
            ["🎂 Age", diversity.age],
            ["📏 Height", diversity.height],
            ["⚖️ Weight", diversity.weight],
          ].map(([label, items]) => h("div", { key:label },
            h("div", { style:{ fontWeight:600, marginBottom:"0.5rem", fontSize:"0.9rem" } }, label),
            h(DistributionBars, { items, onSelectBucket:(item)=>setSelectedBucket({ heading:`${label} — ${item.label}`, performers:item.performers.map(p=>({ ...p, note:`${p.oCount} O${p.oCount!==1?"s":""}` })) }) })
          ))
        )
      ),
      selectedList && h(SceneListModal, { heading:selectedList.heading, subheading:selectedList.subheading, scenes:selectedList.scenes, onClose:()=>setSelectedList(null), onSelectScene:(sid)=>{ setSelectedList(null); setSelectedSceneId(sid); } }),
      selectedBucket && h(PerformerListModal, { heading:selectedBucket.heading, performers:selectedBucket.performers, onClose:()=>setSelectedBucket(null), onSelectPerformer:(pid)=>{ setSelectedBucket(null); setSelectedBucketPerformerId(pid); } }),
      selectedBucketPerformerId && h(PerformerInfoModal, { performerId:selectedBucketPerformerId, onClose:()=>setSelectedBucketPerformerId(null) }),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:()=>setSelectedSceneId(null) })
    );
  }

  function PerformerPodium() {
    const currentYear = getRomeToday().year;
    const [year, setYear] = useState(currentYear); // number, or "all" for All Time
    const [ps, setPs]     = useState({ loading:true, error:null, performers:[] });
    const [selectedPerformer, setSelectedPerformer] = useState(null);
    const [selectedSceneId, setSelectedSceneId] = useState(null);

    useEffect(() => {
      let cancelled = false;
      setPs({ loading:true, error:null, performers:[] });

      async function loadPodium() {
        try {
          const scenes = await fetchOScenesForRanking();
          const scope = year === "all" ? { type:"all" } : { type:"year", value:year };
          const scored = buildRanking(scenes, scope, scene => scene.performers || []);
          if (!cancelled) setPs({ loading:false, error:null, performers:scored });
        } catch(err) {
          if (!cancelled) setPs({ loading:false, error:err.message, performers:[] });
        }
      }

      loadPodium();
      return () => { cancelled = true; };
    }, [year]);

    const years = [];
    for (let y = currentYear; y >= currentYear-10; y--) years.push(y);
    const isAllTime = year === "all";
    const periodLabel = isAllTime ? "All Time" : String(year);

    return h("div", { className:"podium-section" },
      h("div", { className:"podium-header" },
        h("h2", null, isAllTime ? "👑 All-Time Performer Rankings" : "👑 Performer of the Year"),
        h("div", { className:"podium-year-selector" },
          h("button", {
            onClick: () => setYear(isAllTime ? currentYear : "all"),
            style: {
              background: isAllTime ? "rgba(255,200,80,0.15)" : "rgba(255,255,255,0.06)",
              border: "1px solid " + (isAllTime ? "rgba(255,200,80,0.5)" : "rgba(255,255,255,0.12)"),
              color: "inherit", borderRadius: "6px", padding: "0.3rem 0.8rem", cursor: "pointer",
              fontSize: "0.85rem", marginRight: "0.5rem",
            },
          }, "♾️ All Time"),
          !isAllTime && h(React.Fragment, null,
            h("label", null, "Year: "),
            h("select", { value:year, onChange:e=>setYear(Number(e.target.value)), className:"podium-year-select" },
              years.map(y => h("option", { key:y, value:y }, y))
            )
          )
        )
      ),
      ps.loading && h("div", { className:"stash-plus-loading" }, `Loading ${periodLabel} stats…`),
      ps.error   && h("div", { className:"stash-plus-error" },   "Error: "+ps.error),
      !ps.loading && !ps.error && ps.performers.length===0 && h("div", { className:"stash-plus-loading" }, `No O's logged ${isAllTime?"yet":"in "+year}.`),
      !ps.loading && ps.performers.length>0 && h(React.Fragment, null,
        h(PodiumBlock, { performers:ps.performers, onSelectPerformer:setSelectedPerformer }),
        ps.performers.length>3 && h(FullRanking, { performers:ps.performers, onSelectPerformer:setSelectedPerformer })
      ),
      selectedPerformer && h(PerformerScoreModal, { performer:selectedPerformer, onClose:()=>setSelectedPerformer(null), onSelectScene:setSelectedSceneId, entityRoute:"/performers", entityLabel:"performer", periodLabel: isAllTime ? "all time" : "this year" }),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:()=>setSelectedSceneId(null) })
    );
  }

  // Same podium/full-ranking UI as PerformerPodium, but scores O's within a
  // single selected month instead of a whole year (or, with the toggle, across
  // all time — handy for comparing a single good month against the lifetime total).
  function MonthlyPodium() {
    const today = getRomeToday();
    const [month, setMonth] = useState(`${today.year}-${String(today.month+1).padStart(2,"0")}`);
    const [ps, setPs]       = useState({ loading:true, error:null, performers:[] });
    const [selectedPerformer, setSelectedPerformer] = useState(null);
    const [dayData, setDayData] = useState({});
    const [selectedList, setSelectedList] = useState(null);
    const [selectedSceneId, setSelectedSceneId] = useState(null);

    useEffect(() => {
      let cancelled = false;
      setPs({ loading:true, error:null, performers:[] });

      async function loadPodium() {
        try {
          const scenes = await fetchOScenesForRanking();
          const scored = buildRanking(scenes, { type:"month", value:month }, scene => scene.performers || []);
          let dd = buildODayData(scenes);
          const maps = await loadORatingMaps();
          if (maps) dd = enrichDayData(dd, maps.ratings, maps.comments);
          if (!cancelled) setDayData(dd);
          if (!cancelled) setPs({ loading:false, error:null, performers:scored });
        } catch(err) {
          if (!cancelled) setPs({ loading:false, error:err.message, performers:[] });
        }
      }

      loadPodium();
      return () => { cancelled = true; };
    }, [month]);

    const periodLabel = monthLabel(month);

    return h("div", { className:"podium-section" },
      h("div", { className:"podium-header" },
        h("h2", null, "🗓️ Monthly Breakdown"),
        h("div", { className:"podium-year-selector" },
          h("label", null, "Month: "),
          h("input", { type:"month", value:month, onChange:e=>setMonth(e.target.value), onClick:openMonthPicker, className:"podium-year-select" })
        )
      ),
      ps.loading && h("div", { className:"stash-plus-loading" }, `Loading ${periodLabel} stats…`),
      ps.error   && h("div", { className:"stash-plus-error" },   "Error: "+ps.error),
      !ps.loading && !ps.error && h("div", { style:{ display:"flex", flexWrap:"wrap", gap:"3rem", justifyContent:"center", alignItems:"flex-end", marginBottom:"1.5rem" } },
        h("div", { style:{ flex:"0 0 auto" } },
          h(MonthGrid, {
            year: Number(month.slice(0,4)), month: Number(month.slice(5,7)) - 1,
            dayData, cell: 64, showTotal: true,
            onSelectDay: (key, entry) => setSelectedList(dayListPayload(key, entry)),
          })
        ),
        ps.performers.length>0 && h("div", { style:{ flex:"0 0 auto" } },
          h(PodiumBlock, { performers:ps.performers, onSelectPerformer:setSelectedPerformer, showReasons:false })
        )
      ),
      !ps.loading && !ps.error && ps.performers.length===0 && h("div", { className:"stash-plus-loading" }, `No O's logged in ${periodLabel}.`),
      !ps.loading && ps.performers.length>0 && h("div", { style:{ maxWidth:"900px", margin:"0 auto" } },
        h(PodiumBlock, { performers:ps.performers, onSelectPerformer:setSelectedPerformer, showStage:false }),
        ps.performers.length>3 && h(FullRanking, { performers:ps.performers, onSelectPerformer:setSelectedPerformer })
      ),
      selectedPerformer && h(PerformerScoreModal, { performer:selectedPerformer, onClose:()=>setSelectedPerformer(null), onSelectScene:setSelectedSceneId, entityRoute:"/performers", entityLabel:"performer", periodLabel:"this month" }),
      selectedList && h(SceneListModal, {
        heading: selectedList.heading, subheading: selectedList.subheading, scenes: selectedList.scenes,
        onClose: () => setSelectedList(null),
        onSelectScene: (sid) => { setSelectedList(null); setSelectedSceneId(sid); },
      }),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:()=>setSelectedSceneId(null) })
    );
  }

  // Studio ranking podium: identical scoring/UI machinery as the performer
  // podiums, but attributes each O'd scene's points to its studio instead of
  // its cast, with all three time scopes (year / month / all time) in one place.
  function StudioPodium() {
    const today = getRomeToday();
    const currentYear = today.year;
    const [scopeType, setScopeType] = useState("year"); // "year" | "month" | "all"
    const [year, setYear]   = useState(currentYear);
    const [month, setMonth] = useState(`${today.year}-${String(today.month+1).padStart(2,"0")}`);
    const [ps, setPs] = useState({ loading:true, error:null, studios:[] });
    const [selectedStudio, setSelectedStudio] = useState(null);
    const [selectedSceneId, setSelectedSceneId] = useState(null);

    useEffect(() => {
      let cancelled = false;
      setPs({ loading:true, error:null, studios:[] });

      async function loadPodium() {
        try {
          const scenes = await fetchOScenesForRanking();
          const scope = scopeType==="all" ? { type:"all" } : scopeType==="year" ? { type:"year", value:year } : { type:"month", value:month };
          const scored = buildRanking(scenes, scope, scene => scene.studio ? [scene.studio] : []);
          if (!cancelled) setPs({ loading:false, error:null, studios:scored });
        } catch(err) {
          if (!cancelled) setPs({ loading:false, error:err.message, studios:[] });
        }
      }

      loadPodium();
      return () => { cancelled = true; };
    }, [scopeType, year, month]);

    const years = [];
    for (let y = currentYear; y >= currentYear-10; y--) years.push(y);
    const periodLabel = scopeType==="all" ? "All Time" : scopeType==="year" ? String(year) : monthLabel(month);
    const toggleBtn = (key, label) => h("button", {
      onClick: () => setScopeType(key),
      style: {
        background: scopeType===key ? "rgba(255,200,80,0.15)" : "rgba(255,255,255,0.06)",
        border: "1px solid " + (scopeType===key ? "rgba(255,200,80,0.5)" : "rgba(255,255,255,0.12)"),
        color: "inherit", borderRadius: "6px", padding: "0.3rem 0.8rem", cursor: "pointer",
        fontSize: "0.85rem", marginRight: "0.5rem",
      },
    }, label);

    return h("div", { className:"podium-section" },
      h("div", { className:"podium-header" },
        h("h2", null, "🏢 Studio Rankings"),
        h("div", { className:"podium-year-selector" },
          toggleBtn("year", "📆 Yearly"),
          toggleBtn("month", "📅 Monthly"),
          toggleBtn("all", "♾️ All Time"),
          scopeType==="year" && h("select", { value:year, onChange:e=>setYear(Number(e.target.value)), className:"podium-year-select" },
            years.map(y => h("option", { key:y, value:y }, y))
          ),
          scopeType==="month" && h("input", { type:"month", value:month, onChange:e=>setMonth(e.target.value), onClick:openMonthPicker, className:"podium-year-select" })
        )
      ),
      ps.loading && h("div", { className:"stash-plus-loading" }, `Loading ${periodLabel} stats…`),
      ps.error   && h("div", { className:"stash-plus-error" },   "Error: "+ps.error),
      !ps.loading && !ps.error && ps.studios.length===0 && h("div", { className:"stash-plus-loading" }, `No O's logged ${scopeType==="all"?"yet":"in "+periodLabel}.`),
      !ps.loading && ps.studios.length>0 && h(React.Fragment, null,
        h(PodiumBlock, { performers:ps.studios, onSelectPerformer:setSelectedStudio }),
        ps.studios.length>3 && h(FullRanking, { performers:ps.studios, onSelectPerformer:setSelectedStudio })
      ),
      selectedStudio && h(PerformerScoreModal, { performer:selectedStudio, onClose:()=>setSelectedStudio(null), onSelectScene:setSelectedSceneId, entityRoute:"/studios", entityLabel:"studio", periodLabel: scopeType==="all" ? "all time" : scopeType==="year" ? "this year" : "this month" }),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:()=>setSelectedSceneId(null) })
    );
  }

  // ── Recommendations ("For You") ─────────────────────────────────────────
  // How much does the person seem to like this performer/tag/studio, based on
  // how often they show up in O'd scenes and how well those scenes are rated?
  // Log-scaled on O count (so volume matters but doesn't dominate) and boosted
  // by average rating (so a beloved-but-rarely-O'd tag can still surface).
  function tasteWeight(oCount, ratingSum, ratingCount) {
    const avgRating = ratingCount>0 ? ratingSum/ratingCount : 60;
    const ratingNorm = avgRating/100;
    return Math.log(oCount+1) * (0.4 + 0.6*ratingNorm);
  }

  function RecommendedSceneCard({ item, onOpen }) {
    const sc = item.scene;
    return h("div", {
        onClick:()=>onOpen(sc.id),
        className:"stash-plus-card clickable",
        style:{ flexDirection:"column", gap:0, padding:0, overflow:"hidden" },
      },
      sc.screenshot
        ? h("img", { src:sc.screenshot, alt:sc.title, style:{ width:"100%", height:"140px", objectFit:"cover", display:"block" } })
        : h("div", { style:{ width:"100%", height:"140px", background:"rgba(255,255,255,0.06)" } }),
      h("div", { style:{ padding:"0.85rem", width:"100%" } },
        h("div", { style:{ fontWeight:600, fontSize:"0.9rem", marginBottom:"0.3rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, sc.title),
        h("div", { style:{ fontSize:"0.75rem", opacity:0.65, marginBottom:"0.6rem" } },
          [sc.studioName, sc.durMins?`${Math.round(sc.durMins)}m`:null, sc.rating100!=null?`${(sc.rating100/10).toFixed(1)}/10`:null, sc.oCounter?`💦 ${sc.oCounter}`:null].filter(Boolean).join(" · ") || "No details"
        ),
        h("div", { style:{ display:"flex", flexWrap:"wrap", gap:"0.3rem" } },
          item.reasons.map((r,i) => h("span", {
              key:i,
              style:{ fontSize:"0.7rem", background:"rgba(255,200,80,0.12)", color:"#ffc850", borderRadius:"4px", padding:"0.15rem 0.45rem", whiteSpace:"nowrap" },
            },
            r.type==="performer" ? `🎭 ${r.name}` : r.type==="tag" ? `🏷️ ${r.name}` : `🏢 ${r.name}`
          ))
        )
      )
    );
  }

  function SceneCardGrid({ items, onOpen }) {
    return h("div", { style:{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:"1.1rem" } },
      items.map(item => h(RecommendedSceneCard, { key:item.scene.id, item, onOpen }))
    );
  }

  function RecommendationsPage() {
    const [state, setState] = useState({ loading:true, error:null, data:null });
    const [selectedSceneId, setSelectedSceneId] = useState(null);
    const [tagQuery, setTagQuery] = useState("");
    const [tagResults, setTagResults] = useState([]);
    const [selectedTags, setSelectedTags] = useState([]); // [{id,name}]
    const [usePerformerPattern, setUsePerformerPattern] = useState(true);
    const [useStudioPattern, setUseStudioPattern] = useState(true);
    const [topPicksPage, setTopPicksPage] = useState(0);
    const [suggestRewatches, setSuggestRewatches] = useState(false);
    const TOP_PICKS_PAGE_SIZE = 24;

    useEffect(() => {
      let cancelled = false;
      setState({ loading:true, error:null, data:null });

      async function load() {
        try {
          const [watchedData, candidateData] = await Promise.all([
            gqlQuery(`query {
              findScenes(scene_filter:{o_counter:{value:0,modifier:GREATER_THAN}} filter:{per_page:-1}) {
                scenes { id o_counter rating100 performers { id name } studio { id name } files { duration } }
              }
            }`),
            gqlQuery(`query {
              findScenes(scene_filter:{o_counter:{value:0,modifier:${suggestRewatches ? "GREATER_THAN" : "EQUALS"}}} filter:{per_page:-1}) {
                scenes { id title rating100 o_counter performers { id name } tags { id name } studio { id name } files { duration } paths { screenshot } }
              }
            }`),
          ]);
          const watched = watchedData.findScenes.scenes || [];
          const candidates = candidateData.findScenes.scenes || [];

          if (!watched.length) { if (!cancelled) setState({ loading:false, error:null, data:{ noHistory:true } }); return; }

          // Build a taste profile from O'd scenes: which performers/studios keep
          // showing up, weighted by how many O's and how well-rated. Tags are
          // deliberately NOT auto-weighted here — they used to dominate the
          // score, so instead the person picks tags explicitly below.
          const performerStats = new Map(), studioStats = new Map();
          let totalDurMins = 0, durCount = 0;
          const bump = (map, id, name, oCount, rating100) => {
            if (!map.has(id)) map.set(id, { name:name||"Unknown", oCount:0, ratingSum:0, ratingCount:0 });
            const st = map.get(id);
            st.oCount += oCount;
            if (rating100!=null) { st.ratingSum += rating100; st.ratingCount++; }
          };
          watched.forEach(s => {
            const oCount = s.o_counter||0;
            if (!oCount) return;
            const durMins = (s.files&&s.files[0]&&s.files[0].duration) ? s.files[0].duration/60 : 0;
            if (durMins>0) { totalDurMins += durMins; durCount++; }
            (s.performers||[]).forEach(p => bump(performerStats, p.id, p.name, oCount, s.rating100));
            if (s.studio) bump(studioStats, s.studio.id, s.studio.name, oCount, s.rating100);
          });
          const preferredDurationMins = durCount>0 ? totalDurMins/durCount : null;

          const toWeights = map => { const w = new Map(); map.forEach((st,id) => w.set(id, { name:st.name, weight:tasteWeight(st.oCount, st.ratingSum, st.ratingCount) })); return w; };
          const performerWeights = toWeights(performerStats);
          const studioWeights = toWeights(studioStats);

          // Score components kept separate (not summed yet) so Top Picks can
          // toggle performer/studio patterns on or off independently, while the
          // "More with X" rails below always use the full picture.
          const rawCandidates = candidates.map(sc => {
            let performerScore = 0, studioScore = 0, otherScore = 0;
            const performerReasons = [], studioReasons = [];
            (sc.performers||[]).forEach(p => {
              const w = performerWeights.get(p.id);
              if (w) { performerScore += w.weight; performerReasons.push({ type:"performer", id:p.id, name:w.name, weight:w.weight }); }
            });
            if (sc.studio) {
              const w = studioWeights.get(sc.studio.id);
              if (w) { studioScore += w.weight*0.7; studioReasons.push({ type:"studio", id:sc.studio.id, name:w.name, weight:w.weight*0.7 }); }
            }
            if (sc.rating100!=null) otherScore += (sc.rating100/100)*3;
            const durMins = (sc.files&&sc.files[0]&&sc.files[0].duration) ? sc.files[0].duration/60 : 0;
            if (preferredDurationMins && durMins>0) otherScore += Math.max(0, 4 - Math.abs(durMins-preferredDurationMins)/15);
            return {
              scene: { id:sc.id, title:sc.title||"(Untitled scene)", screenshot:(sc.paths&&sc.paths.screenshot)||null, rating100:sc.rating100, durMins, studioName:sc.studio?sc.studio.name:null, oCounter:sc.o_counter||0 },
              performerScore, performerReasons, studioScore, studioReasons, otherScore, tagList: sc.tags||[],
            };
          });

          const topPerformerEntries = Array.from(performerWeights.entries()).sort((a,b)=>b[1].weight-a[1].weight).slice(0,4).map(([id,info])=>({id,name:info.name}));
          const topStudioEntries = Array.from(studioWeights.entries()).sort((a,b)=>b[1].weight-a[1].weight).slice(0,3).map(([id,info])=>({id,name:info.name}));

          if (!cancelled) setState({ loading:false, error:null, data:{ rawCandidates, topPerformerEntries, topStudioEntries } });
        } catch(err) {
          if (!cancelled) setState({ loading:false, error:err.message, data:null });
        }
      }

      load();
      return () => { cancelled = true; };
    }, [suggestRewatches]);

    // Tag search — same debounced search-as-you-type pattern as the Performer
    // Monthly Analysis stat.
    useEffect(() => {
      if (!tagQuery || tagQuery.trim().length < 2) { setTagResults([]); return; }
      let cancelled = false;
      const t = setTimeout(() => {
        gqlQuery(`query($q: String!) {
          findTags(tag_filter:{name:{value:$q, modifier:INCLUDES}} filter:{per_page:8}) {
            tags { id name }
          }
        }`, { q: tagQuery.trim() })
          .then(d => { if (!cancelled) setTagResults((d.findTags.tags||[]).filter(t=>!selectedTags.some(st=>st.id===t.id))); })
          .catch(() => { if (!cancelled) setTagResults([]); });
      }, 300);
      return () => { cancelled = true; clearTimeout(t); };
    }, [tagQuery, selectedTags]);

    // Fold the chosen tags into the score — a strong, additive boost per
    // matching tag, so scenes with your selected tags float to the top while
    // performer/studio/rating/duration still shape the ordering underneath and
    // non-matching scenes still appear further down instead of disappearing.
    const TAG_BOOST = 20;
    const displayData = React.useMemo(() => {
      if (!state.data || state.data.noHistory) return null;
      const selectedIds = new Set(selectedTags.map(t=>t.id));
      const withTagBonus = state.data.rawCandidates.map(c => {
        const matchedTags = selectedIds.size ? c.tagList.filter(t => selectedIds.has(t.id)) : [];
        const tagReasons = matchedTags.map(t => ({ type:"tag", id:t.id, name:t.name, weight:TAG_BOOST }));
        return { ...c, tagBonus: matchedTags.length*TAG_BOOST, tagReasons };
      });

      // "More with X" / "From X" rails always reflect your real habits (full
      // score, toggles don't apply — that's the whole point of those rails).
      const fullScored = withTagBonus.map(c => {
        const score = c.performerScore + c.studioScore + c.otherScore + c.tagBonus;
        const displayReasons = [...c.tagReasons, ...c.performerReasons, ...c.studioReasons].sort((a,b)=>b.weight-a.weight).slice(0,4);
        return { scene:c.scene, score, performerReasons:c.performerReasons, studioReasons:c.studioReasons, displayReasons };
      }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score);

      const railFrom = (entries, key) => entries
        .map(({id,name}) => ({ id, name, scenes: fullScored.filter(x => x[key].some(r=>r.id===id)).slice(0,6).map(x=>({ scene:x.scene, reasons:x.displayReasons })) }))
        .filter(rail => rail.scenes.length>0);

      // Top Picks respects the performer/studio toggles — unchecking one drops
      // its contribution entirely, so tag matches that are totally outside your
      // usual habits can surface instead of always being outweighed.
      const topScored = withTagBonus.map(c => {
        const score = (usePerformerPattern ? c.performerScore : 0) + (useStudioPattern ? c.studioScore : 0) + c.otherScore + c.tagBonus;
        const reasons = [
          ...c.tagReasons,
          ...(usePerformerPattern ? c.performerReasons : []),
          ...(useStudioPattern ? c.studioReasons : []),
        ].sort((a,b)=>b.weight-a.weight).slice(0,4);
        return { scene:c.scene, score, reasons };
      }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score);

      return {
        topScored,
        performerRails: railFrom(state.data.topPerformerEntries, "performerReasons"),
        studioRails: railFrom(state.data.topStudioEntries, "studioReasons"),
      };
    }, [state.data, selectedTags, usePerformerPattern, useStudioPattern]);

    // Changing tags/toggles reorders the ranking, so jump back to page 1 rather
    // than leaving the person stranded on a now-irrelevant page.
    useEffect(() => { setTopPicksPage(0); }, [selectedTags, usePerformerPattern, useStudioPattern]);

    if (state.loading) return h("div", { className:"stash-plus-loading" }, "Finding scenes you might love…");
    if (state.error)   return h("div", { className:"stash-plus-error" }, "Error: "+state.error);
    if (!state.data)   return null;
    if (state.data.noHistory) return h("div", { className:"stash-plus-loading" }, "Log some O's first — recommendations are built from your history.");

    const tagPicker = h("div", { className:"stash-plus-category" },
      h("h2", null, "🏷️ Tags You're In The Mood For"),
      h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } }, "Optional — pick one or more tags to strongly prefer scenes that have them, mixed in with your usual performer/studio/rating patterns."),
      selectedTags.length>0 && h("div", { style:{ display:"flex", flexWrap:"wrap", gap:"0.4rem", marginBottom:"0.6rem" } },
        selectedTags.map(t => h("span", {
            key:t.id,
            onClick:()=>setSelectedTags(prev=>prev.filter(x=>x.id!==t.id)),
            style:{ fontSize:"0.8rem", background:"rgba(255,200,80,0.15)", color:"#ffc850", border:"1px solid rgba(255,200,80,0.4)", borderRadius:"6px", padding:"0.25rem 0.6rem", cursor:"pointer" },
            title:"Remove tag",
          }, `🏷️ ${t.name} ✕`)
        )
      ),
      h("input", {
        type:"text", value:tagQuery, placeholder:"Search tags…",
        onChange: e => setTagQuery(e.target.value),
        className:"podium-year-select", style:{ width:"100%", maxWidth:"320px" },
      }),
      tagResults.length > 0 && h("div", { style:{ marginTop:"0.5rem" } },
        tagResults.map(t => h("div", {
            key:t.id,
            onClick: () => { setSelectedTags(prev=>[...prev, t]); setTagQuery(""); setTagResults([]); },
            className:"podium-row",
          }, h("span", null, `🏷️ ${t.name}`))
        )
      )
    );

    const rewatchToggle = h("label", { style:{ display:"flex", alignItems:"center", gap:"0.4rem", fontSize:"0.85rem", opacity:0.85, cursor:"pointer", marginBottom:"1rem" } },
      h("input", { type:"checkbox", checked:suggestRewatches, onChange:e=>setSuggestRewatches(e.target.checked) }),
      "🔁 Suggest scenes I've already O'd instead, that match these conditions (rewatch mode)"
    );

    if (!displayData || !displayData.topScored.length) {
      return h("div", null,
        rewatchToggle,
        tagPicker,
        h("div", { className:"stash-plus-loading" }, "No strong matches yet. Try different tags, log a few more O's, or you may have already worked through everything relevant!")
      );
    }

    const totalPages = Math.max(1, Math.ceil(displayData.topScored.length / TOP_PICKS_PAGE_SIZE));
    const pageSafe = Math.min(topPicksPage, totalPages-1);
    const pageItems = displayData.topScored.slice(pageSafe*TOP_PICKS_PAGE_SIZE, (pageSafe+1)*TOP_PICKS_PAGE_SIZE);
    const pageBtnStyle = (disabled, active) => ({
      background: active ? "rgba(255,200,80,0.18)" : "rgba(255,255,255,0.06)",
      border: "1px solid " + (active ? "rgba(255,200,80,0.5)" : "rgba(255,255,255,0.12)"),
      color:"inherit", borderRadius:"6px", minWidth:"1.9rem",
      padding:"0.25rem 0.5rem", cursor: disabled?"default":"pointer", opacity: disabled?0.4:1, fontSize:"0.85rem",
      fontWeight: active?700:400,
    });
    // Numbered window of PAGE_WINDOW pages around the current one (e.g. on page
    // 4 of a 4-wide window the numbers shown are 5-8 once you step forward),
    // plus jump-to-first/last (« »)  and step prev/next (‹ ›) controls — handy
    // once a library has more than a handful of pages of picks.
    const PAGE_WINDOW = 4;
    const windowStart = Math.floor(pageSafe / PAGE_WINDOW) * PAGE_WINDOW;
    const windowPages = [];
    for (let i = 0; i < PAGE_WINDOW && windowStart+i < totalPages; i++) windowPages.push(windowStart+i);
    const goTo = p => setTopPicksPage(Math.max(0, Math.min(totalPages-1, p)));
    const pager = totalPages>1 && h("div", { style:{ display:"flex", alignItems:"center", gap:"0.3rem" } },
      h("button", { onClick:()=>goTo(0), disabled:pageSafe===0, style:pageBtnStyle(pageSafe===0), title:"First page" }, "«"),
      h("button", { onClick:()=>goTo(pageSafe-1), disabled:pageSafe===0, style:pageBtnStyle(pageSafe===0), title:"Previous page" }, "‹"),
      windowPages.map(p => h("button", { key:p, onClick:()=>goTo(p), style:pageBtnStyle(false, p===pageSafe) }, p+1)),
      h("button", { onClick:()=>goTo(pageSafe+1), disabled:pageSafe===totalPages-1, style:pageBtnStyle(pageSafe===totalPages-1), title:"Next page" }, "›"),
      h("button", { onClick:()=>goTo(totalPages-1), disabled:pageSafe===totalPages-1, style:pageBtnStyle(pageSafe===totalPages-1), title:"Last page" }, "»")
    );

    return h("div", null,
      h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } },
        suggestRewatches
          ? "Suggestions based on the performers and studios you O the most — pulled from scenes you've already O'd, for when you want a rewatch that matches the mood."
          : "Suggestions based on the performers and studios you O the most — pulled only from scenes you haven't logged an O on yet."
      ),
      rewatchToggle,
      tagPicker,
      h("div", { className:"stash-plus-category" },
        h("div", { style:{
            display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.75rem",
            marginBottom:"0.75rem", borderBottom:"1px solid rgba(255,255,255,0.1)", paddingBottom:"0.4rem",
          } },
          h("div", { style:{ display:"flex", alignItems:"center", gap:"1.1rem", flexWrap:"wrap" } },
            h("h2", { style:{ margin:0, fontSize:"1.1rem", textTransform:"uppercase", letterSpacing:"0.05em", opacity:0.85, border:"none", padding:0 } }, "🎯 Top Picks"),
            h("label", { style:{ display:"flex", alignItems:"center", gap:"0.35rem", fontSize:"0.82rem", opacity:0.85, cursor:"pointer" } },
              h("input", { type:"checkbox", checked:usePerformerPattern, onChange:e=>setUsePerformerPattern(e.target.checked) }),
              "Performer patterns"
            ),
            h("label", { style:{ display:"flex", alignItems:"center", gap:"0.35rem", fontSize:"0.82rem", opacity:0.85, cursor:"pointer" } },
              h("input", { type:"checkbox", checked:useStudioPattern, onChange:e=>setUseStudioPattern(e.target.checked) }),
              "Studio patterns"
            )
          ),
          pager
        ),
        !usePerformerPattern || !useStudioPattern
          ? h("p", { className:"stash-plus-score-note", style:{ marginTop:0 } }, "Discovery mode: ignoring your "+[!usePerformerPattern?"performer":null,!useStudioPattern?"studio":null].filter(Boolean).join(" and ")+" habits, so tag/rating/duration matches outside your usual pattern can surface.")
          : null,
        h(SceneCardGrid, { items:pageItems, onOpen:setSelectedSceneId })
      ),
      displayData.performerRails.map(rail => h("div", { key:"perf-"+rail.id, className:"stash-plus-category" },
        h("h2", null, `🎭 More with ${rail.name}`),
        h(SceneCardGrid, { items:rail.scenes, onOpen:setSelectedSceneId })
      )),
      displayData.studioRails.map(rail => h("div", { key:"studio-"+rail.id, className:"stash-plus-category" },
        h("h2", null, `🏢 From ${rail.name}`),
        h(SceneCardGrid, { items:rail.scenes, onOpen:setSelectedSceneId })
      )),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:()=>setSelectedSceneId(null) })
    );
  }

  // ── O Ratings tab (reads votes saved by the stashOratings plugin) ─────────
  function ORatingsPage() {
    const [state, setState] = useState({ loading:true, error:null, data:null });
    const [selectedSceneId, setSelectedSceneId] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const [bucketFilter, setBucketFilter] = useState(null); // null = all, 0-9 = rating range
    const [sortDir, setSortDir] = useState("desc");         // "desc" = best first, "asc" = worst first

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          if (!window.stashORatings) throw new Error("The stashOratings plugin isn't loaded. Install and enable it first.");
          const [ratings, comments, scenes] = await Promise.all([window.stashORatings.getAll(), window.stashORatings.getComments(), fetchOScenesForRanking()]);
          const items = []; let unrated = 0;
          scenes.forEach(sc => {
            // Every O (first one included) has its own independent rating.
            const hist = (sc.o_history || []).map(ts => new Date(ts).getTime()).filter(t => !isNaN(t)).sort((x, y) => x - y);
            hist.forEach((t, idx) => {
              const r = ratings[`${sc.id}|${t}`] == null ? null : ratings[`${sc.id}|${t}`];
              if (r == null) { unrated++; return; }
              items.push({
                sceneId: sc.id, title: sc.title || "(Untitled scene)",
                screenshot: (sc.paths && sc.paths.screenshot) || null,
                performerNames: (sc.performers || []).map(p => p.name).filter(Boolean),
                rating100: r, t, first: idx === 0, comment: comments[`${sc.id}|${t}`] || null,
              });
            });
          });
          items.sort((a, b) => b.rating100 - a.rating100 || b.t - a.t);
          if (!cancelled) setState({ loading:false, error:null, data:{ items, unrated } });
        } catch (err) { if (!cancelled) setState({ loading:false, error:err.message, data:null }); }
      })();
      return () => { cancelled = true; };
    }, []);

    if (state.loading) return h("div", { className:"stash-plus-loading" }, "Loading O ratings…");
    if (state.error)   return h("div", { className:"stash-plus-error" }, "Error: " + state.error);
    const { items, unrated } = state.data;
    if (!items.length) return h("div", { className:"stash-plus-loading" }, "No rated O's yet. Rate one with the popup next to the O button.");

    const vals = items.map(i => i.rating100 / 10);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const median = vals[Math.floor(vals.length / 2)];
    const best = items[0], worst = items[items.length - 1];
    const buckets = Array.from({ length:10 }, (_, i) => ({ idx:i, label:`${i}-${i + 1}`, count:0, performers:[], selectable:true, active:bucketFilter === i }));
    vals.forEach(v => { buckets[Math.min(9, Math.floor(v))].count++; });
    const bucketOf = i => Math.min(9, Math.floor(i.rating100 / 10));
    const filtered = (bucketFilter == null ? items : items.filter(i => bucketOf(i) === bucketFilter))
      .slice()
      .sort(sortDir === "asc" ? (x, y) => x.rating100 - y.rating100 || x.t - y.t : (x, y) => y.rating100 - x.rating100 || y.t - x.t);
    const shown = showAll ? filtered : filtered.slice(0, 25);

    const stat = (icon, title, desc, onClick) => h("div", { className:"stash-plus-card" + (onClick ? " clickable" : ""), onClick },
      h("div", { className:"stash-plus-card-icon" }, icon),
      h("div", { className:"stash-plus-card-body" },
        h("div", { className:"stash-plus-card-title" }, title),
        h("div", { className:"stash-plus-card-desc" }, desc)));
    const thumb = i => i.screenshot
      ? h("img", { src:i.screenshot, alt:i.title, style:{ width:"96px", height:"54px", objectFit:"cover", borderRadius:"4px", flexShrink:0 } })
      : h("div", { style:{ width:"96px", height:"54px", flexShrink:0, background:"rgba(255,255,255,0.08)", borderRadius:"4px" } });

    return h("div", null,
      h(CollapsibleSection, { title:"📊 O Rating Stats", storageKey:"oRatingStats" },
        h("div", { className:"stash-plus-grid" },
          stat("🗳️", "Rated O's", `${items.length}` + (unrated ? ` (${unrated} still unrated)` : "")),
          stat("📊", "Average", `${avg.toFixed(2)}/10`),
          stat("📐", "Median", `${median.toFixed(1)}/10`),
          stat("🥇", "Best O", `${best.title} — ${(best.rating100 / 10).toFixed(1)}/10`, () => setSelectedSceneId(best.sceneId)),
          stat("🥀", "Worst O", `${worst.title} — ${(worst.rating100 / 10).toFixed(1)}/10`, () => setSelectedSceneId(worst.sceneId))
        ),
        h("div", { style:{ marginTop:"1.25rem", maxWidth:"480px" } },
          h("div", { style:{ fontWeight:600, marginBottom:"0.5rem", fontSize:"0.9rem" } }, "Rating distribution (click a range to filter)"),
          h(DistributionBars, { items:buckets, onSelectBucket:b => { setBucketFilter(prev => prev === b.idx ? null : b.idx); setShowAll(false); } })
        )
      ),
      h(CollapsibleSection, { title:"🏆 O Ranking (" + (sortDir === "asc" ? "worst → best" : "best → worst") + ")", storageKey:"oRatingRanking" },
        h("div", { style:{ display:"flex", alignItems:"center", gap:"0.6rem", flexWrap:"wrap", marginBottom:"0.75rem" } },
          h("button", { className:"podium-year-select", title:"Toggle sort order", onClick:() => setSortDir(sortDir === "desc" ? "asc" : "desc") },
            sortDir === "desc" ? "⬇ Best first" : "⬆ Worst first"),
          bucketFilter != null && h("button", { className:"podium-year-select", title:"Clear filter", onClick:() => { setBucketFilter(null); setShowAll(false); } },
            `Range ${bucketFilter}-${bucketFilter + 1} ✕`),
          h("span", { className:"stash-plus-score-note", style:{ margin:0 } }, `${filtered.length} O${filtered.length !== 1 ? "'s" : ""}`)
        ),
        filtered.length === 0 && h("div", { className:"stash-plus-loading" }, "No O's in this range."),
        shown.map((i, idx) => h("div", { key:i.sceneId + "-" + i.t, className:"podium-row", onClick:() => setSelectedSceneId(i.sceneId) },
          h("span", { className:"podium-row-rank" }, "#" + (idx + 1)),
          thumb(i),
          h("div", { className:"podium-row-info" },
            h("span", { className:"podium-row-name" }, i.title),
            h("span", { className:"podium-row-reason" }, [i.performerNames.join(", ") || null, dateKey(new Date(i.t)), i.first ? "first O" : null].filter(Boolean).join(" · "))
          ),
          i.comment && h("span", { style:{ cursor:"pointer", marginRight:"0.7rem" }, title:"Read comment", onClick:e => { e.stopPropagation(); window.stashORatings.showComment(e.currentTarget, i.comment); } }, "💬"),
          h("span", { className:"podium-row-score" }, `⭐ ${(i.rating100 / 10).toFixed(1)}`)
        )),
        filtered.length > 25 && h("button", { className:"podium-show-more", onClick:() => setShowAll(!showAll) },
          showAll ? "Show less ▲" : `Show all ${filtered.length} O's ▼`)
      ),
      selectedSceneId && h(SceneInfoModal, { sceneId:selectedSceneId, onClose:() => setSelectedSceneId(null) })
    );
  }

  // ── Main page ─────────────────────────────────────────────────────────────
  function StashPlusPage() {
    const [tab, setTab]     = useState("achievements");
    const [state, setState] = useState({ loading:true, error:null, data:null });
    const [modalSceneId, setModalSceneId] = useState(null);
    const [modalDays, setModalDays] = useState(null);
    const [modalPerformerId, setModalPerformerId] = useState(null);
    const [modalPerformerList, setModalPerformerList] = useState(null);
    const [modalChain, setModalChain] = useState(null);
    const [modalSceneList, setModalSceneList] = useState(null);
    const [filter, setFilter] = useState("all");
    const [sortMode, setSortMode] = useState("default"); // "default" | "recent"

    useEffect(() => {
      let cancelled = false;
      loadAllData()
        .then(async data => { data.oRatings = await loadORatingStats(); return data; })
        .then(data => { if (!cancelled) setState({ loading:false, error:null, data }); })
        .catch(err  => { if (!cancelled) setState({ loading:false, error:err.message, data:null }); });
      return () => { cancelled = true; };
    }, []);

    const tabBar = h("div", { className:"stash-plus-tabs" },
      h("button", { className:"stash-plus-tab"+(tab==="achievements"?" active":""), onClick:()=>setTab("achievements") }, "🏆 Achievements"),
      h("button", { className:"stash-plus-tab"+(tab==="podium"?" active":""),       onClick:()=>setTab("podium") },       "👑 Performer of the Year"),
      h("button", { className:"stash-plus-tab"+(tab==="monthly"?" active":""),      onClick:()=>setTab("monthly") },      "🗓️ Monthly Breakdown"),
      h("button", { className:"stash-plus-tab"+(tab==="studios"?" active":""),      onClick:()=>setTab("studios") },      "🏢 Studios"),
      h("button", { className:"stash-plus-tab"+(tab==="foryou"?" active":""),       onClick:()=>setTab("foryou") },       "🔮 For You"),
      h("button", { className:"stash-plus-tab"+(tab==="stats"?" active":""),        onClick:()=>setTab("stats") },        "📈 Stats"),
      h("button", { className:"stash-plus-tab"+(tab==="oratings"?" active":""),   onClick:()=>setTab("oratings") },   "⭐ O Ratings")
    );

    if (tab === "podium") return h("div", { className:"stash-plus-page" }, tabBar, h(PerformerPodium, null));
    if (tab === "monthly") return h("div", { className:"stash-plus-page" }, tabBar, h(MonthlyPodium, null));
    if (tab === "studios") return h("div", { className:"stash-plus-page" }, tabBar, h(StudioPodium, null));
    if (tab === "foryou")  return h("div", { className:"stash-plus-page" }, tabBar, h(RecommendationsPage, null));
    if (tab === "stats")   return h("div", { className:"stash-plus-page" }, tabBar, h(StatsPage, null));
    if (tab === "oratings") return h("div", { className:"stash-plus-page" }, tabBar, h(ORatingsPage, null));

    if (state.loading) return h("div", { className:"stash-plus-page" }, tabBar, h("div", { className:"stash-plus-loading" }, "Calculating your progress…"));
    if (state.error)   return h("div", { className:"stash-plus-page" }, tabBar, h("div", { className:"stash-plus-error"   }, "Error: "+state.error));

    const achievements = getAchievements(state.data);

    // unlockedMap: { [achievementId]: timestampMs }. Reads may encounter the old
    // array format from earlier plugin versions, so migrate it transparently.
    let unlockedMap = {};
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
      if (Array.isArray(raw)) raw.forEach(id => { unlockedMap[id] = 0; }); // legacy format, no timestamp known
      else if (raw && typeof raw === "object") unlockedMap = raw;
    } catch(e) {}
    const newlyUnlocked = achievements.filter(a => a.current>=a.target && !(a.id in unlockedMap)).map(a=>a.id);
    if (newlyUnlocked.length) {
      const now = Date.now();
      newlyUnlocked.forEach(id => { unlockedMap[id] = now; });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(unlockedMap)); } catch(e) {}
    }

    const total      = achievements.length;
    const unlocked   = achievements.filter(a => (a.id in unlockedMap) || a.current>=a.target).length;
    const pct        = total > 0 ? Math.round((unlocked/total)*100) : 0;
    const baseVisible = filter==="completed" ? achievements.filter(a=>a.current>=a.target)
                      : filter==="missing"   ? achievements.filter(a=>a.current<a.target)
                      : achievements;
    // "Recently Unlocked" flattens category grouping and sorts unlocked
    // achievements newest-first (unknown/legacy timestamps sort last among unlocked),
    // followed by everything still locked.
    const visible = sortMode==="recent"
      ? [...baseVisible].sort((x,y) => {
          const xu = x.id in unlockedMap, yu = y.id in unlockedMap;
          if (xu && yu) return (unlockedMap[y.id]||0) - (unlockedMap[x.id]||0);
          if (xu !== yu) return xu ? -1 : 1;
          return 0;
        })
      : baseVisible;
    const categories = sortMode==="recent" ? ["Recently Unlocked"] : [...new Set(visible.map(a=>a.category))];

    const filterBtn = (key, label) => h("button", {
      onClick: () => setFilter(filter===key ? "all" : key),
      style: {
        background: filter===key ? "rgba(255,200,80,0.15)" : "rgba(255,255,255,0.06)",
        border: "1px solid " + (filter===key ? "rgba(255,200,80,0.5)" : "rgba(255,255,255,0.12)"),
        color: "inherit", borderRadius: "6px", padding: "0.4rem 0.9rem", cursor: "pointer",
        fontSize: "0.85rem", marginRight: "0.5rem",
      },
    }, label);

    return h("div", { className:"stash-plus-page" },
      tabBar,
      h("div", { className:"stash-plus-header" },
        h("h1", null, "🏆 Achievements"),
        h("div", { className:"stash-plus-summary" }, `${unlocked} / ${total} unlocked (${pct}%)`),
        h(ProgressBar, { current:unlocked, target:total, large:true }),
        h("div", { style:{ marginTop:"0.75rem" } },
          filterBtn("completed", "✅ Completed"),
          filterBtn("missing", "🔒 Missing"),
          h("button", {
            onClick: () => setSortMode(sortMode==="recent" ? "default" : "recent"),
            style: {
              background: sortMode==="recent" ? "rgba(255,200,80,0.15)" : "rgba(255,255,255,0.06)",
              border: "1px solid " + (sortMode==="recent" ? "rgba(255,200,80,0.5)" : "rgba(255,255,255,0.12)"),
              color: "inherit", borderRadius: "6px", padding: "0.4rem 0.9rem", cursor: "pointer",
              fontSize: "0.85rem", marginRight: "0.5rem",
            },
          }, "🕒 Recently Unlocked")
        )
      ),
      categories.map(cat =>
        h("div", { key:cat, className:"stash-plus-category" },
          h("h2", null, cat),
          h("div", { className:"stash-plus-grid" },
            visible.filter(a=>a.category===cat).map(a =>
              h(AchievementCard, { key:a.id, a, unlocked:a.current>=a.target, onOpenScene:setModalSceneId, onOpenDays:setModalDays, onOpenPerformer:setModalPerformerId, onOpenPerformerList:setModalPerformerList, onOpenChain:setModalChain, onOpenSceneList:setModalSceneList })
            )
          )
        )
      ),
      modalSceneId && h(SceneInfoModal, { sceneId:modalSceneId, onClose:()=>setModalSceneId(null) }),
      modalDays && h(ThreeOfKindModal, { days:modalDays, onClose:()=>setModalDays(null), onSelectScene:(sid)=>{ setModalDays(null); setModalSceneId(sid); } }),
      modalPerformerList && h(PerformerListModal, { heading:modalPerformerList.heading, subheading:modalPerformerList.subheading, performers:modalPerformerList.performers, onClose:()=>setModalPerformerList(null), onSelectPerformer:(pid)=>{ setModalPerformerList(null); setModalPerformerId(pid); } }),
      modalChain && h(PerformerChainModal, { heading:modalChain.heading, path:modalChain.path, links:modalChain.links, onClose:()=>setModalChain(null), onSelectPerformer:(pid)=>{ setModalChain(null); setModalPerformerId(pid); }, onSelectScene:(sid)=>{ setModalChain(null); setModalSceneId(sid); } }),
      modalSceneList && h(SceneListModal, { heading:modalSceneList.heading, subheading:modalSceneList.subheading, scenes:modalSceneList.scenes, onClose:()=>setModalSceneList(null), onSelectScene:(sid)=>{ setModalSceneList(null); setModalSceneId(sid); } }),
      modalPerformerId && h(PerformerInfoModal, { performerId:modalPerformerId, onClose:()=>setModalPerformerId(null) })
    );
  }

  // ── Register ──────────────────────────────────────────────────────────────
  PluginApi.register.route("/stash-plus", StashPlusPage);

  PluginApi.patch.before("MainNavBar.UtilityItems", function(props) {
    const { NavLink } = PluginApi.libraries.ReactRouterDOM;
    return [{
      children: h(React.Fragment, null,
        props.children,
        h(NavLink, { to:"/stash-plus", className:"nav-utility-item stash-plus-nav-link", title:"Stash+" },
          h("span", { className:"stash-plus-nav-icon" }, "➕"),
          h("span", { className:"stash-plus-nav-label" }, " Stash+")
        )
      ),
    }];
  });

})();
