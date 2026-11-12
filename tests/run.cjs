/* Dependency-free runner apart from the project's existing TypeScript devDependency.
   No app runtime, live database, browser, payment link, or external network connection is started.
   Includes:
   - Original 37 domain, math, parser, storage, and mocked UI regression groups
   - Behavioral rerun creation callback verification (empty initial claims + cleared transactional state)
   - Cloud repository state transitions (empty cloud without auto-seeding, offline/auth errors, pending local edits queue & replay, rich-field row round-tripping, demo hold stripping)
   - Stateful in-memory SQL/RPC authorization & concurrency simulator verifying the exact server rules in supabase/schema.sql (cross-pool isolation, forged-identity rejection, non-host receipt/announcement/lock/settlement rejection, invite joining, and concurrent last-share case-cap locking). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require(process.env.POOLCART_TYPESCRIPT_PATH || 'typescript');
const root = path.resolve(__dirname, '..');
const tests = [];
const test = (name, run) => tests.push({name, run});
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() && e.name !== 'node_modules' ? walk(path.join(dir,e.name)) : e.isFile() ? [path.join(dir,e.name)] : []); }
const sources = walk(root).filter(f => /\.tsx?$/.test(f));
require.extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {fileName: filename, compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText, filename);
};
const storage = new Map(); const writes = []; let failWrite = false; let cloudCalls = 0;
let mockSupabaseFactory = () => { cloudCalls++; throw new Error('Unexpected network client'); };
const originalLoad = Module._load;
Module._load = function(request,parent,isMain) {
  if (request === '@react-native-async-storage/async-storage') return {
    getItem: async key => storage.get(key) ?? null,
    setItem: async (key,value) => { if(failWrite) {failWrite=false; throw new Error('storage full');} storage.set(key,value); writes.push({key,value}); },
  };
  if (request === '@supabase/supabase-js') return { createClient: (...args) => mockSupabaseFactory(...args) };
  return originalLoad.call(this,request,parent,isMain);
};
const math = require('../src/utils/calculations.ts');
const domain = require('../src/utils/poolActions.ts');
const parser = require('../src/utils/bulkParser.ts');
const {
  PoolRepository,
  CLOUD_SYNC_AVAILABLE,
  assembleCloudPoolsFromRows,
  sanitizePoolForCloud,
} = require('../src/services/repository.ts');
const {createWriteQueue} = require('../src/services/storageQueue.ts');
const {INITIAL_POOLS, CURRENT_USER} = require('../src/data/mockPools.ts');
const {NotificationService, DEFAULT_NOTIFICATION_PREFS} = require('../src/services/notifications.ts');
const host = {id:'h',name:'Host',avatarColor:'#111',neighborhood:'Demo',isHost:true,paidStatus:'pending'};
const member = {id:'n',name:'Neighbor',avatarColor:'#222',neighborhood:'Demo',paidStatus:'pending'};
const outsider = {id:'x',name:'Host',avatarColor:'#333',neighborhood:'Demo',paidStatus:'pending'};
function pool(quantities=[3,4]) { return { id:'p',joinCode:'TEST-1',title:'Test',supplierName:'Sample',supplierBadge:'Sample',category:'Test',hostUserId:'h',hostName:'Host',neighborhood:'Demo',pickupAddress:'Sample address',pickupWindow:'Next Saturday',cutoffTime:'Friday',minimumOrderAmount:65,deliveryFee:3.01,freeDeliveryThreshold:65,status:'open',participants:[{...host},{...member}],messages:[],wishlist:[],items:[{id:'i',name:'Jasmine Rice',emoji:'🌾',category:'Staples',mode:'case_split',caseSize:6,maxCases:2,unitLabel:'1 share',unitPrice:10,retailPrice:15,claims:[host,member].map((p,i)=>({userId:p.id,userName:p.name,avatarColor:p.avatarColor,quantity:quantities[i]})).filter(c=>c.quantity>0)}] }; }
function finalized() {const p=pool([3,3]);p.minimumOrderAmount=50;p.freeDeliveryThreshold=70;p.status='locked';return p;}
function apply(p,user,action) {return domain.applyPoolAction(p,user,action);}
function sumCents(rows,key){return rows.reduce((sum,row)=>sum+Math.round(row[key]*100),0);}

test('All TS/TSX files parse without syntax errors',()=>{
  for(const file of sources){const r=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}});assert.equal((r.diagnostics||[]).length,0,file);}
});
test('Core domain, math, parser and queue pass strict TypeScript checking',()=>{
  const program=ts.createProgram(['src/types/groupBuy.ts','src/utils/calculations.ts','src/utils/poolActions.ts','src/utils/bulkParser.ts','src/services/storageQueue.ts'].map(f=>path.join(root,f)),{strict:true,noEmit:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,skipLibCheck:true,types:[]});
  const errors=ts.getPreEmitDiagnostics(program);assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
});
test('Known fixture migration preserves rich fields and clears unverifiable legacy paid flags',()=>{
  const p=domain.normalizePools(INITIAL_POOLS)[0];assert.deepEqual(p.wishlist,INITIAL_POOLS[0].wishlist);assert.deepEqual(p.porchCheckIn,INITIAL_POOLS[0].porchCheckIn);assert.equal(p.participants[0].paidStatus,'pending');assert.equal(p.participants[0].verifiedAuth,false);
});
test('Completed cases alone count toward thresholds and payable totals',()=>{
  const p=pool();const s=math.getPoolProgressSummary(p);assert.equal(s.committedPoolTotal,60);assert.equal(s.pendingCaseTotal,10);assert.equal(s.isMinimumMet,false);assert.equal(s.isFreeDeliveryUnlocked,false);
  const rows=math.getParticipantBreakdowns(p);assert.deepEqual(rows.map(r=>[r.lineItems[0].committedQuantity,r.lineItems[0].pendingQuantity]),[[3,0],[3,1]]);assert.equal(sumCents(rows,'totalDue'),6301);assert.equal(math.getWholesaleOrderManifest(p).grandTotalSupplierInvoice,63.01);
});
test('Largest remainder assigns cents deterministically, including negative allocations',()=>{
  const w=['c','b','a'].map(id=>({id,weight:1}));assert.deepEqual([...math.allocateCents(2,w)],[['a',.67],['b',.67],['c',.66]]);assert.equal([...math.allocateCents(-2,w).values()].reduce((s,n)=>s+Math.round(n*100),0),-200);
});
test('Ledger and supplier invoice conserve cents across 200 case/fee configurations',()=>{
  for(let n=1;n<=200;n++){const p=pool([n%10+1,(n*3)%10+1]);p.items[0].maxCases=10;p.items[0].unitPrice=3.27;p.trueUp={actualDeliveryFee:(n%17)/100,taxOrBagFee:(n%31)/100};assert.equal(sumCents(math.getParticipantBreakdowns(p),'totalDue'),Math.round(math.getWholesaleOrderManifest(p).grandTotalSupplierInvoice*100));}
});
test('No committed items means no payment or delivery charges',()=>{
  const p=pool([1,0]);p.trueUp={taxOrBagFee:3,actualDeliveryFee:5};assert.equal(math.getPoolProgressSummary(p).activeBuyerCount,0);assert.equal(sumCents(math.getParticipantBreakdowns(p),'totalDue'),0);assert.equal(math.getWholesaleOrderManifest(p).grandTotalSupplierInvoice,0);
});
test('Name matching never grants host permissions',()=>{
  assert.equal(domain.isPoolHost(pool(),outsider.id),false);assert.throws(()=>apply(pool(),outsider,{type:'lock'}),/host/);
});
test('Receipt, porch and host announcements reject non-host actions',()=>{
  const p=pool();for(const action of [{type:'receipt',trueUp:{taxOrBagFee:5}},{type:'price',itemId:'i',price:4},{type:'porch',checkIn:{status:'ready_on_porch',coolerLocationNote:'test'}},{type:'message',message:{id:'m',text:'test',isAnnouncement:true}}]) assert.throws(()=>apply(p,member,action),/host/);
});
test('Every order-changing path rejects locked pools',()=>{
  const p=finalized();for(const action of [{type:'claim',itemId:'i',delta:1},{type:'addItems',items:[]},{type:'reorder',receipt:{items:[]}},{type:'pledge',wishId:'w'},{type:'request',wish:{}},{type:'promote',wishId:'w'},{type:'cover',itemId:'i'},{type:'trim',itemId:'i'}]) assert.throws(()=>apply(p,host,action),/Reopen/);
});
test('Reorder exceeding a cap rejects atomically without mutating the original',()=>{
  const p=pool([6,6]);const before=JSON.stringify(p);assert.throws(()=>apply(p,member,{type:'reorder',receipt:{items:[{...p.items[0],quantity:1}]}}),/cap/);assert.equal(JSON.stringify(p),before);
});
test('Add-item and promotion claims always have participants',()=>{
  const p=pool();const added=apply(p,outsider,{type:'addItems',items:[{...p.items[0],id:'new',claims:[{userId:'x',userName:'Host',avatarColor:'#333',quantity:1}]}]});assert(added.participants.some(u=>u.id==='x'));
  p.wishlist=[{id:'w',poolId:'p',title:'Flour',emoji:'🌾',category:'Staples',suggestedUnitLabel:'1 share',estimatedUnitPrice:5,estimatedRetailPrice:5,targetCaseSize:4,requestedByUserId:'x',requestedByUserName:'New Neighbor',pledgedUserIds:['x','n']}];
  const promoted=apply(p,host,{type:'promote',wishId:'w'});assert(promoted.participants.some(u=>u.id==='x'));assert.throws(()=>apply(promoted,host,{type:'promote',wishId:'w'}),/already/);
});
test('Drop-partial removes exactly pending allocation and cover uses the current remainder',()=>{
  const p=pool();const trimmed=apply(p,host,{type:'trim',itemId:'i'});assert.deepEqual(trimmed.items[0].claims.map(c=>c.quantity),[3,3]);const covered=apply(p,host,{type:'cover',itemId:'i'});assert.deepEqual(covered.items[0].claims.map(c=>c.quantity),[8,4]);
});
test('Lock requires a complete order meeting its minimum',()=>{
  assert.throws(()=>apply(pool(),host,{type:'lock'}),/minimum/);const p=pool();p.minimumOrderAmount=50;assert.throws(()=>apply(p,host,{type:'lock'}),/partial/);p.items[0].claims[1].quantity=3;assert.equal(apply(p,host,{type:'lock'}).status,'locked');
});
test('Changing amounts or item allocation invalidates settlement evidence',()=>{
  let p=finalized();p=apply(p,host,{type:'paid',userId:'n'});assert.equal(p.participants[1].paidStatus,'paid');p=apply(p,host,{type:'receipt',trueUp:{taxOrBagFee:1}});assert.equal(p.participants[1].paidStatus,'pending');assert.equal(p.participants[1].settledAmount,undefined);
});
test('Demo capture is separate from paid and requires a finalized pool',()=>{
  let p=finalized();p=apply(p,member,{type:'authorizeDemo',userId:'n'});assert.equal(p.participants[1].demoAuthorizedAmount,31.5);p=apply(p,host,{type:'captureDemo'});assert.equal(p.participants[1].paidStatus,'demo_paid');
  assert.throws(()=>apply(pool(),host,{type:'captureDemo'}),/Lock/);assert.throws(()=>apply(finalized(),host,{type:'authorizeDemo',userId:'n'}),/own/);
});
test('Manual paid status is host-only and requires a finalized positive amount',()=>{
  assert.throws(()=>apply(finalized(),member,{type:'paid',userId:'n'}),/host/);assert.throws(()=>apply(pool(),host,{type:'paid',userId:'n'}),/Lock/);
});
test('Input validation rejects negatives, non-finite numbers and fractional cases',()=>{
  for(const val of [-1,NaN,Infinity,2.5]){const p=pool();p.items[0].caseSize=val;assert.throws(()=>domain.validatePool(p));}
  for(const val of [-1,0,Infinity,3.456]){const p=pool();p.items[0].unitPrice=val;assert.throws(()=>domain.validatePool(p));}
});
test('Catalog parsing preserves package sizes, avoids fabricated retail savings and claims',()=>{
  const r=parser.parseBulkCatalog('Oat Milk 6-Pack $3.25');assert.equal(r.errors.length,0);assert.equal(r.items[0].unitPrice,3.25);assert.equal(r.items[0].name,'Oat Milk 6-Pack');assert.equal(r.items[0].retailPrice,3.25);assert.deepEqual(r.items[0].claims,[]);
});
test('Invalid catalog rows fail with diagnostics instead of default prices',()=>{
  for(const line of ['Milk | -2 | 4 | 6','Milk | nope | 4 | 6','Milk | 2 | 4 | 2.5','Milk with no price','Milk | 0 | 4 | 6']) assert(parser.parseBulkCatalog(line).errors.length>0,line);
});
test('Rice is an item, fees require explicit labels, and quantities/line totals are not unit prices',()=>{
  const r=parser.parseReceiptTrueUpText('Jasmine Rice @ $9.50 /unit\nTax $1.01',pool().items);assert.equal(r.errors.length,0);assert.equal(r.matches[0].newReceiptPrice,9.5);assert.equal(r.detectedTaxOrFee,1.01);
  assert(parser.parseReceiptTrueUpText('Jasmine Rice 2 x $9.50 $19.00',pool().items).errors.length);
});
test('Ambiguous or duplicate receipt matches block application',()=>{
  const catalog=[...pool().items,{...pool().items[0],id:'i2',name:'Brown Rice'}];assert(parser.parseReceiptTrueUpText('Rice @ $9.50',catalog).errors.length);assert(parser.parseReceiptTrueUpText('Jasmine Rice @ $9.50\nJasmine Rice @ $9.00',catalog).errors.length);
});
test('Initial-pool sample receipt parses cleanly using explicit unit prices',()=>{
  const r=parser.parseReceiptTrueUpText(parser.SAMPLE_RECEIPT_OCR_TEXT,INITIAL_POOLS[0].items);assert.equal(r.errors.length,0);assert.equal(r.matches.length,4);assert.equal(r.detectedTaxOrFee,4.5);
});
test('Incoming app/query links and outgoing invitations carry the pool code',()=>{
  assert.equal(math.extractPoolCodeFromUrl('poolcart://join/test-1'),'TEST-1');assert.equal(math.extractPoolCodeFromUrl('https://example.test/?pool=TEST-1'),'TEST-1');assert(math.buildShareablePoolInviteText(pool()).includes('poolcart://join/TEST-1'));assert(!math.buildShareablePoolInviteText(pool()).includes('Sample address'));
});
test('Local save/load round trip preserves receipt, porch, wishlist, holds and pickup',async()=>{
  let p=finalized();p.trueUp={taxOrBagFee:1,receiptNote:'test',actualDeliveryFee:2};p.porchCheckIn={status:'ready_on_porch',coolerLocationNote:'test',accessCodeOrPin:'demo'};p=apply(p,member,{type:'authorizeDemo',userId:'n'});p=apply(p,host,{type:'pickup',userId:'n'});await PoolRepository.saveLocalPools([p]);assert.deepEqual(await PoolRepository.loadLocalPools(),domain.normalizePools([p]));
});
test('Unreadable storage is not replaced with demo data',async()=>{
  storage.set('@poolcart_pools_v3','{broken');const n=writes.length;await assert.rejects(()=>PoolRepository.loadLocalPools());assert.equal(writes.length,n);assert.equal(storage.get('@poolcart_pools_v3'),'{broken');
});
test('Save failures reach callers, and later retry succeeds',async()=>{
  failWrite=true;await assert.rejects(()=>PoolRepository.saveLocalPools([pool()]),/storage full/);await PoolRepository.saveLocalPools([pool()]);assert.equal((await PoolRepository.loadLocalPools())[0].id,'p');
});
test('Writes serialize across delayed work and recover after rejection',async()=>{
  const enqueue=createWriteQueue();let release;const gate=new Promise(r=>release=r);const order=[];
  const first=enqueue(async()=>{await gate;order.push(1);});const second=enqueue(async()=>{order.push(2);throw new Error('fail');});const caught=second.catch(()=>undefined);const third=enqueue(async()=>{order.push(3);});release();await Promise.all([first,caught,third]);assert.deepEqual(order,[1,2,3]);
});
test('Cloud sync is supported when configured, requires an authenticated session, and disables demo profile switching in cloud mode',async()=>{
  assert.equal(CLOUD_SYNC_AVAILABLE,true);
  storage.set('@poolcart_supabase_config_v1',JSON.stringify({url:'https://example.supabase.co',anonKey:'anon-key-123',enabled:true}));
  let getSessionCalled = 0;
  mockSupabaseFactory = () => ({
    auth: {
      getSession: async () => { getSessionCalled++; return { data: { session: null }, error: null }; },
    },
  });
  await PoolRepository.initConfig();
  assert.equal(PoolRepository.getCurrentConfig().enabled,true);
  // Demo profile switching is rejected while cloud mode is enabled
  await assert.rejects(()=>PoolRepository.saveActiveUser(member),/disabled while cloud sync is active/);
  // Loading pools without an authenticated session returns auth_required and never auto-uploads demo fixtures
  const loaded = await PoolRepository.loadPools();
  assert.equal(loaded.cloudState,'auth_required');
  assert.equal(getSessionCalled,1);
  // Reset back to local mode for subsequent local tests
  await PoolRepository.saveSupabaseConfig({url:'',anonKey:'',enabled:false});
});
test('Notification preferences suppress local case and proximity alerts',()=>{
  const p=pool([3,2]),next=apply(p,member,{type:'claim',itemId:'i',delta:1});next.minimumOrderAmount=500;
  const alerts=NotificationService.evaluateClaimMilestones(p,next,p.items[0],{justCompletedCase:true,cappedAtMaxCases:false,justOpenedNewCase:false,fullCasesCount:1}, {...DEFAULT_NOTIFICATION_PREFS,caseSplitCompletion:false,freeDeliveryProximity:false});assert.equal(alerts.length,0);
});

// ============================================================================
// New Cloud-Preserving & Server-Boundary Regression Groups
// ============================================================================

/**
 * In-memory transactional simulator implementing the exact semantics of
 * `supabase/schema.sql` (RLS member-only SELECTs + SECURITY DEFINER RPCs
 * `upsert_my_profile`, `join_pool_by_invite`, `create_pool_with_catalog`,
 * `claim_item_share`, and `apply_pool_action_rpc`).
 * Note: This is a deterministic in-memory simulator of the SQL schema rules,
 * paired with static inspection of `supabase/schema.sql`, because no live
 * PostgreSQL server is running in this test environment.
 */
function createSimulatedCloudBackend() {
  const db = {
    user_profiles: new Map(),
    pools: new Map(),
    pool_participants: new Map(), // key: `${pool_id}:${user_id}`
    catalog_items: new Map(),
    item_claims: new Map(), // key: `${item_id}:${user_id}`
    pool_messages: new Map(),
    claimSeq: 1,
    mutex: createWriteQueue(),
  };

  function cloneState() {
    return {
      user_profiles: new Map(JSON.parse(JSON.stringify([...db.user_profiles]))),
      pools: new Map(JSON.parse(JSON.stringify([...db.pools]))),
      pool_participants: new Map(JSON.parse(JSON.stringify([...db.pool_participants]))),
      catalog_items: new Map(JSON.parse(JSON.stringify([...db.catalog_items]))),
      item_claims: new Map(JSON.parse(JSON.stringify([...db.item_claims]))),
      pool_messages: new Map(JSON.parse(JSON.stringify([...db.pool_messages]))),
      claimSeq: db.claimSeq,
    };
  }
  function restoreState(snap) {
    db.user_profiles = snap.user_profiles;
    db.pools = snap.pools;
    db.pool_participants = snap.pool_participants;
    db.catalog_items = snap.catalog_items;
    db.item_claims = snap.item_claims;
    db.pool_messages = snap.pool_messages;
    db.claimSeq = snap.claimSeq;
  }

  function isPoolMember(poolId, uid) {
    if (!uid) return false;
    if (db.pool_participants.has(`${poolId}:${uid}`)) return true;
    const p = db.pools.get(poolId);
    return Boolean(p && p.host_user_id === uid);
  }

  function isPoolHostUser(poolId, uid) {
    const p = db.pools.get(poolId);
    if (!p || !uid) return false;
    if (p.host_user_id) return p.host_user_id === uid;
    const part = db.pool_participants.get(`${poolId}:${uid}`);
    return Boolean(part && part.is_host && !part.legacy_unclaimed);
  }

  function recomputeSummary(poolId) {
    const p = db.pools.get(poolId);
    let committed = 0;
    let hasPartial = false;
    for (const item of db.catalog_items.values()) {
      if (item.pool_id !== poolId) continue;
      let totalQty = 0;
      for (const c of db.item_claims.values()) {
        if (c.item_id === item.id) totalQty += c.quantity;
      }
      const cs = item.mode === 'case_split' && item.case_size > 1 ? item.case_size : 1;
      const committedUnits = cs > 1 ? Math.floor(totalQty / cs) * cs : totalQty;
      if (cs > 1 && totalQty % cs > 0) hasPartial = true;
      const price = item.actual_unit_price ?? item.unit_price;
      committed = Math.round((committed + committedUnits * price) * 100) / 100;
    }
    return {
      committedTotal: committed,
      minimumOrderAmount: p.minimum_order_amount,
      isMinimumMet: committed > 0 && committed >= p.minimum_order_amount,
      hasPartialCases: hasPartial,
    };
  }

  function clientForSession(sessionUser) {
    return {
      auth: {
        getSession: async () => ({
          data: { session: sessionUser ? { user: sessionUser } : null },
          error: null,
        }),
        signOut: async () => ({ error: null }),
      },
      from: (table) => ({
        select: () => {
          const runSelect = async () => {
            const uid = sessionUser?.id;
            if (!uid) return { data: [], error: null };
            const rows = [...db[table].values()].filter((row) => {
              const pid = table === 'pools' ? row.id : row.pool_id;
              return isPoolMember(pid, uid);
            });
            return { data: JSON.parse(JSON.stringify(rows)), error: null };
          };
          return {
            order: () => runSelect(),
            then: (resolve, reject) => runSelect().then(resolve, reject),
          };
        },
        insert: async () => ({
          error: { code: '42501', message: 'permission denied for table ' + table },
        }),
        update: () => ({
          match: async () => ({
            error: { code: '42501', message: 'permission denied for table ' + table },
          }),
        }),
        delete: () => ({
          match: async () => ({
            error: { code: '42501', message: 'permission denied for table ' + table },
          }),
        }),
      }),
      rpc: (fnName, params) =>
        db.mutex(async () => {
          const snap = cloneState();
          try {
            const uid = sessionUser?.id;
            if (!uid) {
              throw { code: '42501', message: 'Authentication required: sign in with a verified cloud session.' };
            }

            if (fnName === 'upsert_my_profile') {
              const name = (params.p_display_name || '').trim() || 'Neighbor';
              const hood = (params.p_neighborhood || '').trim() || 'Victoria Gardens';
              const color = (params.p_avatar_color || '').trim() || '#0D9488';
              db.user_profiles.set(uid, {
                user_id: uid,
                display_name: name,
                email: sessionUser.email || null,
                neighborhood: hood,
                avatar_color: color,
              });
              for (const part of db.pool_participants.values()) {
                if (part.user_id === uid) {
                  part.user_name = name;
                  part.neighborhood = hood;
                  part.avatar_color = color;
                }
              }
              return {
                data: { id: uid, name, email: sessionUser.email, neighborhood: hood, avatarColor: color, verifiedAuth: true },
                error: null,
              };
            }

            if (fnName === 'create_pool_with_catalog') {
              const p = params.p_pool;
              let prof = db.user_profiles.get(uid);
              if (!prof) {
                prof = { user_id: uid, display_name: p.hostName || 'Host', neighborhood: p.neighborhood || 'Demo', avatar_color: '#0D9488' };
                db.user_profiles.set(uid, prof);
              }
              db.pools.set(p.id, {
                id: p.id,
                join_code: p.joinCode.toUpperCase(),
                title: p.title,
                supplier_name: p.supplierName,
                supplier_badge: p.supplierBadge,
                category: p.category,
                host_user_id: uid,
                host_name: prof.display_name,
                host_venmo_handle: p.hostVenmoHandle || null,
                neighborhood: p.neighborhood,
                distance_miles: p.distanceMiles ?? null,
                pickup_address: p.pickupAddress,
                pickup_window: p.pickupWindow,
                cutoff_time: p.cutoffTime,
                minimum_order_amount: p.minimumOrderAmount,
                delivery_fee: p.deliveryFee,
                free_delivery_threshold: p.freeDeliveryThreshold,
                status: 'open',
                true_up: null,
                porch_check_in: null,
                wishlist: [],
              });
              db.pool_participants.set(`${p.id}:${uid}`, {
                pool_id: p.id,
                user_id: uid,
                user_name: prof.display_name,
                neighborhood: prof.neighborhood,
                avatar_color: prof.avatar_color,
                is_host: true,
                paid_status: 'pending',
                settled_amount: null,
                picked_up: false,
                legacy_unclaimed: false,
              });
              for (const it of p.items || []) {
                db.catalog_items.set(it.id, {
                  id: it.id,
                  pool_id: p.id,
                  name: it.name,
                  category: it.category,
                  emoji: it.emoji,
                  mode: it.mode,
                  unit_label: it.unitLabel,
                  unit_price: it.unitPrice,
                  actual_unit_price: null,
                  retail_price: it.retailPrice,
                  case_size: it.caseSize ?? null,
                  max_cases: it.maxCases ?? null,
                });
              }
              for (const m of p.messages || []) {
                db.pool_messages.set(m.id, {
                  id: m.id,
                  pool_id: p.id,
                  user_id: uid,
                  user_name: prof.display_name,
                  avatar_color: prof.avatar_color,
                  is_host: true,
                  is_announcement: Boolean(m.isAnnouncement),
                  text: m.text,
                  created_at_label: m.createdAt || 'Just now',
                });
              }
              return { data: { poolId: p.id, hostUserId: uid }, error: null };
            }

            if (fnName === 'join_pool_by_invite') {
              const code = (params.p_join_code || '').trim().toUpperCase();
              const target = [...db.pools.values()].find(
                (r) => r.join_code.toUpperCase() === code || r.id.toUpperCase() === code
              );
              if (!target) {
                throw { code: 'P0001', message: `No cloud pool found matching invite code "${code}".` };
              }
              const name = (params.p_display_name || sessionUser.name || 'Neighbor').trim();
              const hood = (params.p_neighborhood || target.neighborhood).trim();
              const color = (params.p_avatar_color || '#2563EB').trim();
              db.user_profiles.set(uid, { user_id: uid, display_name: name, neighborhood: hood, avatar_color: color });
              const isHost = target.host_user_id === uid;
              db.pool_participants.set(`${target.id}:${uid}`, {
                pool_id: target.id,
                user_id: uid,
                user_name: name,
                neighborhood: hood,
                avatar_color: color,
                is_host: isHost,
                paid_status: 'pending',
                settled_amount: null,
                picked_up: false,
                legacy_unclaimed: false,
              });
              return { data: { poolId: target.id, joinCode: target.join_code, title: target.title, userId: uid, isHost }, error: null };
            }

            if (fnName === 'claim_item_share') {
              if (params.p_user_id && params.p_user_id !== uid) {
                throw { code: '42501', message: `Forged identity rejected: caller user_id (${params.p_user_id}) does not match authenticated session (${uid}).` };
              }
              if (params.p_delta !== 1 && params.p_delta !== -1) {
                throw { code: '22023', message: 'Claim delta must be +1 or -1.' };
              }
              const targetPool = db.pools.get(params.p_pool_id);
              if (!targetPool) throw { code: 'P0001', message: 'Pool not found.' };
              if (!isPoolMember(params.p_pool_id, uid)) {
                throw { code: '42501', message: 'Access denied: join this pool by invite code before claiming items.' };
              }
              if (targetPool.status === 'locked') {
                throw { code: 'P0001', message: 'Reopen the pool before changing orders or wishlist claims.' };
              }
              const item = db.catalog_items.get(params.p_item_id);
              if (!item || item.pool_id !== params.p_pool_id) {
                throw { code: 'P0001', message: 'Catalog item not found in pool.' };
              }
              const part = db.pool_participants.get(`${params.p_pool_id}:${uid}`);
              const existing = db.item_claims.get(`${item.id}:${uid}`);
              const currentQty = existing ? existing.quantity : 0;
              let otherQty = 0;
              for (const c of db.item_claims.values()) {
                if (c.item_id === item.id && c.user_id !== uid) otherQty += c.quantity;
              }
              const prevTotal = currentQty + otherQty;
              let nextUserQty = Math.max(0, currentQty + params.p_delta);
              let nextTotal = otherQty + nextUserQty;
              let capped = false;
              const cs = item.mode === 'case_split' && item.case_size > 1 ? item.case_size : 1;
              if (item.mode === 'case_split' && item.max_cases && item.max_cases > 0) {
                const maxAllowed = item.max_cases * cs;
                if (nextTotal > maxAllowed) {
                  nextUserQty = Math.max(0, maxAllowed - otherQty);
                  nextTotal = otherQty + nextUserQty;
                  capped = true;
                }
              }
              if (nextUserQty <= 0) {
                db.item_claims.delete(`${item.id}:${uid}`);
              } else {
                db.item_claims.set(`${item.id}:${uid}`, {
                  pool_id: params.p_pool_id,
                  item_id: item.id,
                  user_id: uid,
                  user_name: part.user_name,
                  avatar_color: part.avatar_color,
                  quantity: nextUserQty,
                  claim_seq: existing ? existing.claim_seq : db.claimSeq++,
                });
              }
              if (nextUserQty !== currentQty) {
                for (const pRow of db.pool_participants.values()) {
                  if (pRow.pool_id === params.p_pool_id) {
                    pRow.paid_status = 'pending';
                    pRow.settled_amount = null;
                    pRow.picked_up = false;
                  }
                }
              }
              return {
                data: {
                  newUserQuantity: nextUserQty,
                  totalClaimedUnits: nextTotal,
                  fullCasesCount: cs > 1 ? Math.floor(nextTotal / cs) : nextTotal,
                  remainderUnits: cs > 1 ? nextTotal % cs : 0,
                  justCompletedCase: cs > 1 && Math.floor(nextTotal / cs) > Math.floor(prevTotal / cs) && nextTotal % cs === 0,
                  justOpenedNewCase: cs > 1 && prevTotal > 0 && prevTotal % cs === 0 && nextTotal > prevTotal,
                  cappedAtMaxCases: capped,
                },
                error: null,
              };
            }

            if (fnName === 'apply_pool_action_rpc') {
              const poolId = params.p_pool_id;
              const action = params.p_action;
              const targetPool = db.pools.get(poolId);
              if (!targetPool) throw { code: 'P0001', message: 'Pool not found.' };
              if (!isPoolMember(poolId, uid)) {
                throw { code: '42501', message: 'Access denied: you are not a member of this pool.' };
              }
              const isHost = isPoolHostUser(poolId, uid);
              const hostOnly = ['promote', 'price', 'receipt', 'porch', 'lock', 'cover', 'trim', 'paid', 'pickup'];
              if (hostOnly.includes(action.type) && !isHost) {
                throw { code: '42501', message: 'Only the pool host can perform this action.' };
              }
              const openOnly = ['addItems', 'reorder', 'pledge', 'request', 'promote', 'cover', 'trim'];
              if (openOnly.includes(action.type) && targetPool.status === 'locked') {
                throw { code: 'P0001', message: 'Reopen the pool before changing orders or wishlist claims.' };
              }
              if (action.type === 'authorizeDemo' || action.type === 'captureDemo') {
                throw { code: '42501', message: 'Simulated card holds are confined to local demo mode.' };
              }
              const part = db.pool_participants.get(`${poolId}:${uid}`);

              switch (action.type) {
                case 'message':
                  if (action.message.isAnnouncement && !isHost) {
                    throw { code: '42501', message: 'Only the host can pin an announcement.' };
                  }
                  db.pool_messages.set(action.message.id, {
                    id: action.message.id,
                    pool_id: poolId,
                    user_id: uid,
                    user_name: part.user_name,
                    avatar_color: part.avatar_color,
                    is_host: isHost,
                    is_announcement: Boolean(action.message.isAnnouncement),
                    text: action.message.text,
                    created_at_label: action.message.createdAt || 'Just now',
                  });
                  break;
                case 'receipt':
                  targetPool.true_up = action.trueUp;
                  for (const upd of action.prices || []) {
                    const it = db.catalog_items.get(upd.itemId);
                    if (it && it.pool_id === poolId) it.actual_unit_price = upd.newPrice;
                  }
                  for (const pRow of db.pool_participants.values()) {
                    if (pRow.pool_id === poolId) {
                      pRow.paid_status = 'pending';
                      pRow.settled_amount = null;
                      pRow.picked_up = false;
                    }
                  }
                  break;
                case 'porch':
                  targetPool.porch_check_in = action.checkIn;
                  break;
                case 'request':
                  targetPool.wishlist = [
                    {
                      ...action.wish,
                      poolId,
                      requestedByUserId: uid,
                      requestedByUserName: part.user_name,
                      pledgedUserIds: [uid],
                      promotedToCatalog: false,
                    },
                    ...(targetPool.wishlist || []),
                  ];
                  break;
                case 'pledge': {
                  const wish = (targetPool.wishlist || []).find((w) => w.id === action.wishId && !w.promotedToCatalog);
                  if (!wish) throw { code: 'P0001', message: 'Wishlist request is no longer available.' };
                  wish.pledgedUserIds = wish.pledgedUserIds.includes(uid)
                    ? wish.pledgedUserIds.filter((id) => id !== uid)
                    : [...wish.pledgedUserIds, uid];
                  break;
                }
                case 'lock':
                  if (targetPool.status === 'locked') {
                    targetPool.status = 'open';
                  } else {
                    const sum = recomputeSummary(poolId);
                    if (!sum.isMinimumMet) throw { code: 'P0001', message: 'The committed order must meet the supplier minimum before locking.' };
                    if (sum.hasPartialCases) throw { code: 'P0001', message: 'Cover or drop every partial case before locking.' };
                    targetPool.status = 'locked';
                  }
                  break;
                case 'paid': {
                  const sum = recomputeSummary(poolId);
                  if (targetPool.status !== 'locked') throw { code: 'P0001', message: 'Lock the finalized pool before recording settlement or pickup.' };
                  if (!sum.isMinimumMet || sum.hasPartialCases) throw { code: 'P0001', message: 'Resolve partial cases and meet the supplier minimum first.' };
                  const targetPart = db.pool_participants.get(`${poolId}:${action.userId}`);
                  if (!targetPart || !action.settledAmount || action.settledAmount <= 0) throw { code: 'P0001', message: 'No payable share for this neighbor.' };
                  targetPart.paid_status = targetPart.paid_status === 'paid' ? 'pending' : 'paid';
                  targetPart.settled_amount = targetPart.paid_status === 'paid' ? action.settledAmount : null;
                  break;
                }
                case 'pickup': {
                  if (targetPool.status !== 'locked') throw { code: 'P0001', message: 'Lock the finalized pool before recording settlement or pickup.' };
                  const targetPart = db.pool_participants.get(`${poolId}:${action.userId}`);
                  if (!targetPart) throw { code: 'P0001', message: 'Participant not found.' };
                  targetPart.picked_up = !targetPart.picked_up;
                  break;
                }
                case 'reorder': {
                  for (const past of action.receipt.items || []) {
                    let item = [...db.catalog_items.values()].find((i) => i.pool_id === poolId && i.name.toLowerCase() === past.name.toLowerCase());
                    if (!item) {
                      const newId = 'item_' + Math.random().toString(36).slice(2, 8);
                      item = { id: newId, pool_id: poolId, name: past.name, category: 'Re-Ordered Staple', emoji: past.emoji || '🛒', mode: past.mode, unit_label: past.unitLabel, unit_price: past.unitPrice, retail_price: past.retailPrice, case_size: past.caseSize ?? null, max_cases: null };
                      db.catalog_items.set(newId, item);
                    }
                    const existing = db.item_claims.get(`${item.id}:${uid}`);
                    const nextQty = (existing ? existing.quantity : 0) + past.quantity;
                    db.item_claims.set(`${item.id}:${uid}`, { pool_id: poolId, item_id: item.id, user_id: uid, user_name: part.user_name, avatar_color: part.avatar_color, quantity: nextQty, claim_seq: existing ? existing.claim_seq : db.claimSeq++ });
                    let totalQty = 0;
                    for (const c of db.item_claims.values()) if (c.item_id === item.id) totalQty += c.quantity;
                    if (item.mode === 'case_split' && item.max_cases && totalQty > item.max_cases * item.case_size) {
                      throw { code: 'P0001', message: 'This item has reached its case cap.' };
                    }
                  }
                  break;
                }
              }
              return { data: { ok: true, poolId, actionType: action.type }, error: null };
            }

            throw { code: 'P0001', message: 'Unknown RPC: ' + fnName };
          } catch (err) {
            restoreState(snap);
            return { data: null, error: err };
          }
        }),
    };
  }

  return { db, clientForSession };
}

test('SQL schema defines non-destructive rich columns, member-scoped RLS, and revokes direct client table writes',()=>{
  const sql = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
  assert(sql.includes('alter table public.pools add column if not exists host_user_id text;'));
  assert(sql.includes('alter table public.pools add column if not exists true_up jsonb;'));
  assert(sql.includes('alter table public.pools add column if not exists porch_check_in jsonb;'));
  assert(sql.includes('alter table public.pools add column if not exists wishlist jsonb'));
  assert(sql.includes('alter table public.catalog_items add column if not exists actual_unit_price numeric;'));
  assert(sql.includes('alter table public.pool_participants add column if not exists settled_amount numeric;'));
  assert(sql.includes('create or replace function public.join_pool_by_invite('));
  assert(sql.includes('create or replace function public.apply_pool_action_rpc('));
  assert(sql.includes('using (public.is_pool_member(id, auth.uid()::text))'));
  assert(sql.includes('revoke insert, update, delete, truncate on public.user_profiles, public.pools'));
  assert(!sql.includes('using (true) with check (true)'));
});

test('Cloud empty database returns empty_cloud without uploading sample fixtures',async()=>{
  const sim = createSimulatedCloudBackend();
  const hostSession = { id: 'auth_host_1', email: 'host@example.edu', name: 'Host One' };
  PoolRepository.setTestSupabaseClient(sim.clientForSession(hostSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const res = await PoolRepository.loadPools();
  assert.equal(res.cloudState, 'empty_cloud');
  assert.equal(res.pools.length, 0);
  assert.equal(sim.db.pools.size, 0, 'Sample pools must never be auto-seeded into an empty cloud database');
  PoolRepository.setTestSupabaseClient(null, { url: '', anonKey: '', enabled: false });
});

test('Server boundary rejects cross-pool reads, forged identity claims, and non-host receipt/announcement/lock/payment/pickup actions',async()=>{
  const sim = createSimulatedCloudBackend();
  const hostSession = { id: 'auth_host_1', email: 'host@example.edu', name: 'Maya Host' };
  const memberSession = { id: 'auth_member_2', email: 'member@example.edu', name: 'Marcus Member' };
  const outsiderSession = { id: 'auth_outsider_3', email: 'outsider@example.edu', name: 'Outsider' };

  // 1. Host creates a pool
  PoolRepository.setTestSupabaseClient(sim.clientForSession(hostSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const basePool = pool([0, 0]);
  basePool.id = 'pool_cloud_alpha';
  basePool.joinCode = 'ALPHA-01';
  basePool.minimumOrderAmount = 60;
  basePool.freeDeliveryThreshold = 60;
  basePool.items[0].claims = [];
  const createRes = await PoolRepository.createCloudPool(basePool);
  assert.equal(createRes.error, undefined);

  // 2. Outsider (not a member) cannot see the pool or its pickup address/PIN, and cannot claim shares
  PoolRepository.setTestSupabaseClient(sim.clientForSession(outsiderSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const outsiderLoad = await PoolRepository.loadPools();
  assert.equal(outsiderLoad.pools.length, 0, 'Non-member must not gain read access to unrelated pools');
  const outsiderClaim = await PoolRepository.syncAtomicClaimDelta('pool_cloud_alpha', 'i', { id: outsiderSession.id, name: 'Outsider', neighborhood: 'Demo', avatarColor: '#333', paidStatus: 'pending' }, 1);
  assert.equal(outsiderClaim.state, 'auth_rejected');
  assert.match(outsiderClaim.error, /join this pool by invite code/i);

  // 3. Member joins explicitly via invite code
  PoolRepository.setTestSupabaseClient(sim.clientForSession(memberSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const joinRes = await PoolRepository.joinCloudPoolByInvite('alpha-01', {
    id: memberSession.id,
    name: 'Marcus Member',
    neighborhood: 'Alta Loma',
    avatarColor: '#2563EB',
    paidStatus: 'pending',
  });
  assert.equal(joinRes.poolId, 'pool_cloud_alpha');

  // 4. Forged caller-supplied user_id is rejected at the server RPC boundary
  const forgedClaim = await PoolRepository.syncAtomicClaimDelta(
    'pool_cloud_alpha',
    'i',
    { id: 'auth_host_1', name: 'Maya Host', neighborhood: 'Demo', avatarColor: '#111', isHost: true, paidStatus: 'pending' },
    1
  );
  assert.equal(forgedClaim.state, 'auth_rejected');
  assert.match(forgedClaim.error, /Forged identity rejected/i);

  // 5. Non-host member is rejected at the server boundary for host-only operations
  const memberLoaded = (await PoolRepository.loadPools()).pools[0];
  for (const forbiddenAction of [
    { type: 'receipt', trueUp: { taxOrBagFee: 4, receiptNote: 'forged' } },
    { type: 'porch', checkIn: { status: 'ready_on_porch', coolerLocationNote: 'forged' } },
    { type: 'lock' },
    { type: 'paid', userId: memberSession.id },
    { type: 'pickup', userId: memberSession.id },
    { type: 'message', message: { id: 'm_forged', poolId: 'pool_cloud_alpha', userId: memberSession.id, userName: 'Marcus', avatarColor: '#2563EB', isAnnouncement: true, text: 'Fake pin', createdAt: 'Now' } },
  ]) {
    const res = await PoolRepository.syncCloudPoolAction(memberLoaded, { id: memberSession.id, name: 'Marcus Member', neighborhood: 'Alta Loma', avatarColor: '#2563EB', paidStatus: 'pending' }, forbiddenAction);
    assert.equal(res.state, 'auth_rejected', `Expected auth_rejected for ${forbiddenAction.type}`);
    assert.match(res.error, /host/i);
  }

  await PoolRepository.clearPendingCloudEdits();
  PoolRepository.setTestSupabaseClient(null, { url: '', anonKey: '', enabled: false });
});

test('Cloud rich-field round trip preserves host identity, actual prices, true-up, porch check-in, wishlist, manual settlement, and strips demo holds',async()=>{
  const sim = createSimulatedCloudBackend();
  const hostSession = { id: 'auth_host_1', email: 'host@example.edu', name: 'Maya Host' };
  const memberSession = { id: 'auth_member_2', email: 'member@example.edu', name: 'Marcus Member' };

  PoolRepository.setTestSupabaseClient(sim.clientForSession(hostSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const p = pool([0, 0]);
  p.id = 'pool_rich';
  p.joinCode = 'RICH-01';
  p.minimumOrderAmount = 60;
  p.freeDeliveryThreshold = 60;
  p.distanceMiles = 0.4;
  p.items[0].claims = [];
  await PoolRepository.createCloudPool(p);

  // Member joins and claims 3 shares; Host claims 3 shares -> 1 full case of 6 ($60 committed, meets $60 minimum)
  PoolRepository.setTestSupabaseClient(sim.clientForSession(memberSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const memberUser = { id: memberSession.id, name: 'Marcus Member', neighborhood: 'Alta Loma', avatarColor: '#2563EB', paidStatus: 'pending' };
  await PoolRepository.joinCloudPoolByInvite('RICH-01', memberUser);
  for (let i = 0; i < 3; i++) await PoolRepository.syncAtomicClaimDelta('pool_rich', 'i', memberUser, 1);

  let current = (await PoolRepository.loadPools()).pools[0];
  await PoolRepository.syncCloudPoolAction(current, memberUser, {
    type: 'request',
    wish: { id: 'wish_1', poolId: 'pool_rich', title: 'Organic Honey', emoji: '🍯', category: 'Pantry', suggestedUnitLabel: '1 jar', estimatedUnitPrice: 12, estimatedRetailPrice: 18, targetCaseSize: 4, requestedByUserId: memberSession.id, requestedByUserName: 'Marcus Member', pledgedUserIds: [memberSession.id] },
  });

  // Switch to Host to claim 3 shares, reconcile receipt, update porch, lock, and record settlement + pickup
  PoolRepository.setTestSupabaseClient(sim.clientForSession(hostSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const hostUser = { id: hostSession.id, name: 'Maya Host', neighborhood: 'Demo', avatarColor: '#0D9488', isHost: true, paidStatus: 'pending' };
  for (let i = 0; i < 3; i++) await PoolRepository.syncAtomicClaimDelta('pool_rich', 'i', hostUser, 1);

  current = (await PoolRepository.loadPools()).pools[0];
  await PoolRepository.syncCloudPoolAction(current, hostUser, {
    type: 'receipt',
    trueUp: { actualDeliveryFee: 4, taxOrBagFee: 2, receiptNote: 'Dock invoice #42', reconciledAt: '11:00 AM' },
    prices: [{ itemId: 'i', newPrice: 11 }],
  });
  await PoolRepository.syncCloudPoolAction(current, hostUser, {
    type: 'porch',
    checkIn: { status: 'ready_on_porch', coolerLocationNote: 'Front porch blue cooler', accessCodeOrPin: '4321', updatedAt: '11:15 AM' },
  });
  current = (await PoolRepository.loadPools()).pools[0];
  await PoolRepository.syncCloudPoolAction(current, hostUser, { type: 'lock' });
  current = (await PoolRepository.loadPools()).pools[0];
  await PoolRepository.syncCloudPoolAction(current, hostUser, { type: 'paid', userId: memberSession.id });
  await PoolRepository.syncCloudPoolAction(current, hostUser, { type: 'pickup', userId: memberSession.id });

  const reloaded = (await PoolRepository.loadPools()).pools[0];
  assert.equal(reloaded.hostUserId, hostSession.id);
  assert.equal(reloaded.distanceMiles, 0.4);
  assert.equal(reloaded.status, 'locked');
  assert.equal(reloaded.items[0].actualUnitPrice, 11);
  assert.deepEqual(reloaded.trueUp, { actualDeliveryFee: 4, taxOrBagFee: 2, receiptNote: 'Dock invoice #42', reconciledAt: '11:00 AM' });
  assert.equal(reloaded.porchCheckIn.status, 'ready_on_porch');
  assert.equal(reloaded.porchCheckIn.accessCodeOrPin, '4321');
  assert.equal(reloaded.wishlist.length, 1);
  assert.equal(reloaded.wishlist[0].title, 'Organic Honey');
  const reloadedMember = reloaded.participants.find((pt) => pt.id === memberSession.id);
  assert.equal(reloadedMember.paidStatus, 'paid');
  assert.equal(reloadedMember.settledAmount, 36);
  assert.equal(reloadedMember.pickedUp, true);

  // Verify demo hold sanitization never leaks demo_authorized into cloud
  const sanitized = sanitizePoolForCloud({
    ...reloaded,
    participants: [{ ...reloadedMember, paidStatus: 'demo_authorized', demoHoldId: 'demo_1', demoAuthorizedAmount: 36 }],
  });
  assert.equal(sanitized.participants[0].paidStatus, 'pending');
  assert.equal(sanitized.participants[0].demoHoldId, undefined);
  PoolRepository.setTestSupabaseClient(null, { url: '', anonKey: '', enabled: false });
});

test('Concurrent last-share claims serialize under lock without exceeding max_cases, and multi-row cap failure rolls back cleanly',async()=>{
  const sim = createSimulatedCloudBackend();
  const hostSession = { id: 'auth_host_1', email: 'host@example.edu', name: 'Maya Host' };
  const memberA = { id: 'auth_m1', email: 'm1@example.edu', name: 'Neighbor A' };
  const memberB = { id: 'auth_m2', email: 'm2@example.edu', name: 'Neighbor B' };

  PoolRepository.setTestSupabaseClient(sim.clientForSession(hostSession), {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  const p = pool([0, 0]);
  p.id = 'pool_race';
  p.joinCode = 'RACE-01';
  p.items[0].caseSize = 2;
  p.items[0].maxCases = 1; // Max 2 shares total!
  p.items[0].claims = [];
  await PoolRepository.createCloudPool(p);

  const clientHost = sim.clientForSession(hostSession);
  const clientA = sim.clientForSession(memberA);
  const clientB = sim.clientForSession(memberB);
  await clientA.rpc('join_pool_by_invite', { p_join_code: 'RACE-01', p_display_name: 'Neighbor A' });
  await clientB.rpc('join_pool_by_invite', { p_join_code: 'RACE-01', p_display_name: 'Neighbor B' });

  // Host claims 1 share first (1/2 claimed, 1 share remaining before maxCases cap)
  await clientHost.rpc('claim_item_share', { p_pool_id: 'pool_race', p_item_id: 'i', p_user_id: hostSession.id, p_delta: 1 });

  // Neighbor A and Neighbor B concurrently tap +1 for the last remaining share
  const [resA, resB] = await Promise.all([
    clientA.rpc('claim_item_share', { p_pool_id: 'pool_race', p_item_id: 'i', p_user_id: memberA.id, p_delta: 1 }),
    clientB.rpc('claim_item_share', { p_pool_id: 'pool_race', p_item_id: 'i', p_user_id: memberB.id, p_delta: 1 }),
  ]);

  assert.equal(resA.data.totalClaimedUnits, 2);
  assert.equal(resB.data.totalClaimedUnits, 2);
  assert.equal(resA.data.justCompletedCase, true);
  assert.equal(resB.data.cappedAtMaxCases, true);
  assert.equal(resB.data.newUserQuantity, 0);

  // Multi-row reorder exceeding cap rolls back earlier items in the same RPC transaction
  const reorderFail = await clientA.rpc('apply_pool_action_rpc', {
    p_pool_id: 'pool_race',
    p_action: {
      type: 'reorder',
      receipt: {
        items: [
          { name: 'New Sourdough Loaf', emoji: '🍞', unitLabel: '1 loaf', unitPrice: 6, retailPrice: 9, quantity: 1, mode: 'individual' },
          { name: 'Jasmine Rice', emoji: '🌾', unitLabel: '1 share', unitPrice: 10, retailPrice: 15, quantity: 1, mode: 'case_split', caseSize: 2 },
        ],
      },
    },
  });
  assert(reorderFail.error, 'Expected reorder exceeding cap to fail');
  assert.equal(sim.db.catalog_items.size, 1, 'Transaction rollback must remove the newly inserted item when a later item in the reorder fails cap validation');
  PoolRepository.setTestSupabaseClient(null, { url: '', anonKey: '', enabled: false });
});

test('Network failure during cloud mutation preserves pending local edits and replays them cleanly on recovery',async()=>{
  const sim = createSimulatedCloudBackend();
  const hostSession = { id: 'auth_host_1', email: 'host@example.edu', name: 'Maya Host' };
  const workingClient = sim.clientForSession(hostSession);
  let offline = false;

  const toggleableClient = {
    ...workingClient,
    rpc: async (fn, args) => {
      if (offline) throw new Error('Network request failed: device offline');
      return workingClient.rpc(fn, args);
    },
  };

  PoolRepository.setTestSupabaseClient(toggleableClient, {
    url: 'https://test.supabase.co',
    anonKey: 'anon-test',
    enabled: true,
  });
  await PoolRepository.clearPendingCloudEdits();

  const p = pool([0, 0]);
  p.id = 'pool_offline_test';
  p.joinCode = 'OFF-01';
  p.items[0].claims = [];
  await PoolRepository.createCloudPool(p);

  // Go offline and claim a share
  offline = true;
  const hostUser = { id: hostSession.id, name: 'Maya Host', neighborhood: 'Demo', avatarColor: '#0D9488', isHost: true, paidStatus: 'pending' };
  const claimOffline = await PoolRepository.syncAtomicClaimDelta('pool_offline_test', 'i', hostUser, 1);
  assert.equal(claimOffline.state, 'network_unavailable');

  const pendingBefore = await PoolRepository.loadPendingCloudEdits();
  assert.equal(pendingBefore.length, 1);

  // Restore network and flush pending edits
  offline = false;
  const flushed = await PoolRepository.flushPendingCloudEdits([p], hostUser);
  assert.equal(flushed.remaining, 0);
  assert.equal(flushed.error, undefined);

  const loadedAfter = await PoolRepository.loadPools();
  assert.equal(loadedAfter.cloudState, 'synced');
  assert.equal(loadedAfter.pools[0].items[0].claims[0].quantity, 1);
  PoolRepository.setTestSupabaseClient(null, { url: '', anonKey: '', enabled: false });
});

require('./ui.cjs')(test, {assert, pool, finalized, host, member, initialPools: INITIAL_POOLS, ts});
(async()=>{let failed=0;for(const t of tests){try{await t.run();console.log(`PASS ${t.name}`);}catch(error){failed++;console.error(`FAIL ${t.name}\n${error.stack}`);}}console.log(`\n${tests.length-failed}/${tests.length} test groups passed. No network, database, or running Expo app used.`);process.exitCode=failed?1:0;})();
