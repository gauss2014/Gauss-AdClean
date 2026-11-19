import { BinaryReader, BinaryWriter } from '@protobuf-ts/runtime';

// Field numbers from BiliUniverse/ADBlock v0.6.19. Preserve untouched wire
// ranges verbatim, including unknown fields and 64-bit IDs.
const rules = {
  'bilibili.app.dynamic.v2.Dynamic/DynAll': {3:true,1:{1:{skipEnum:[1,15]}}},
  'bilibili.app.view.v1.View/View': {30:true,31:true,41:true,10:{skipMessage:28}},
  'bilibili.app.view.v1.View/TFInfo': {2:true,3:true},
  'bilibili.app.viewunite.v1.View/View': {
    7:{3:true,5:{1:{2:{9:true}}}},
    5:{1:{2:{2:{skipEnum:[1,55],22:{1:{skipEnum:[1,4,5]}}}}}}
  },
  'bilibili.community.service.dm.v1.DM/DmView': {18:true}
};
export function rewriteView(method, buf) {
  const plan=rules[method];
  if (!plan) return;
  return edit(plan,buf);
}
function edit(plan, buf) {
  const r=new BinaryReader(buf,{}), w=new BinaryWriter({});
  let last=0, changed=false;
  while(r.pos<r.len){
    const start=r.pos,[f,t]=r.tag();
    if ((plan.skipMessage===f && t===2) ||
        (plan.skipEnum?.[0]===f && t===0 && plan.skipEnum.slice(1).includes(r.uint32()))) return null;
    if(plan.skipEnum?.[0]===f && t===0) continue;
    const sub=plan[f];
    if(!sub || t!==2){r.skip(t);continue;}
    const payload=r.bytes(), result=sub===true?null:edit(sub,payload);
    if(result===undefined) continue;
    w.raw(buf.subarray(last,start));
    if(result!==null) w.tag(f,2).bytes(result);
    last=r.pos;changed=true;
  }
  if(changed) return w.raw(buf.subarray(last)).finish();
}
