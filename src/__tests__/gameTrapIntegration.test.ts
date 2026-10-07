import {describe,it,expect,afterEach} from "vitest";
import {createRequire} from "node:module";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {useEditorStore} from "../store/editorStore";
import {readWorkspace,saveWorkspace} from "../server/gameWorkspace";
import type {ProjectFile} from "../lib/projectIO";
import type {GamePreviewScene} from "../lib/gamePreview";
import type {GameComparison} from "../lib/gameComparison";
const requireCjs=createRequire(import.meta.url);
type Paths={gameRoot:string;baselineRoot:string;outputRoot:string};
const core=requireCjs("../../scripts/game-sync/core.cjs") as {
 createSyncProject(input:Paths&{mapName:string}):{project:ProjectFile};
 previewEditedProject(p:ProjectFile,paths:Paths):GamePreviewScene;
 exportEditedProject(p:ProjectFile,paths:Paths):{candidateId:string;candidateDir:string;report:{exactMapBytes:boolean;applyFiles:string[]}};
 compareEditedProject(p:ProjectFile,paths:Paths):{comparison:GameComparison};
 reviewCandidate(id:{candidateId:string;mapName:string;baselineId:string},paths:Paths):{status:string};
 packageCandidate(id:{candidateId:string;mapName:string;baselineId:string},paths:Paths):{bytes:Buffer};
 validateStorageRoot(target:string,root:string):string;
};
const gameRoot=process.env.MSW_GAME_SYNC_TEST_ROOT,temps:string[]=[];
afterEach(()=>{useEditorStore.getState().newProject();for(const dir of temps.splice(0))rmSync(dir,{recursive:true,force:true});});
describe.skipIf(!gameRoot)("actual game trap editor round trip",()=>{
 it("edits, saves, reopens and packages valley traps without changing game data",()=>{
  const temp=mkdtempSync(join(tmpdir(),"msw-trap-editor-"));temps.push(temp);const paths={gameRoot:gameRoot!,baselineRoot:join(temp,"baselines"),outputRoot:join(temp,"candidates")};
  const watched=["map/ferenforestvalley.map","map/ferenforestvalley.json","RootDesk/MyDesk/DataSet/world/DT_MapTrap.csv","RootDesk/MyDesk/DataSet/world/DT_Walk.csv","RootDesk/MyDesk/DataSet/world/DT_Portal.csv"],hash=(f:string)=>createHash("sha256").update(readFileSync(join(gameRoot!,f))).digest("hex"),before=watched.map(hash);
  const {project}=core.createSyncProject({...paths,mapName:"ferenforestvalley"}),scene=core.previewEditedProject(project,paths),trap=scene.traps?.find(t=>t.trapId==="valley_coma");expect(trap).toBeDefined();
  const nextMax:[number,number]=[trap!.maxCell[0]>trap!.cell[0]?trap!.maxCell[0]-1:Math.min(project.size[0]-1,trap!.maxCell[0]+1),trap!.maxCell[1]];
  const store=useEditorStore.getState();store.loadProject(project,project.palette.map(t=>({...t,img:null,url:"",hash:t.hash??null})));expect(useEditorStore.getState().updateGameTrap("valley_coma",{maxCell:nextMax},scene)).toBe(true);
  const edited=JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())) as ProjectFile,changed=core.previewEditedProject(edited,paths);expect(changed.traps?.find(t=>t.trapId==="valley_coma")?.maxCell).toEqual(nextMax);expect(core.compareEditedProject(edited,paths).comparison.traps?.updated).toHaveLength(1);
  const workspace={...paths,workspaceRoot:join(temp,"workspaces"),validateStorageRoot:core.validateStorageRoot},saved=saveWorkspace(edited,null,workspace),reopened=readWorkspace("ferenforestvalley",workspace)!;expect(reopened.revision).toBe(saved.revision);expect(reopened.project.gameTrapEdits).toEqual(edited.gameTrapEdits);
  const candidate=core.exportEditedProject(reopened.project,paths);expect(candidate.report.exactMapBytes).toBe(true);expect(candidate.report.applyFiles).toEqual(["map/ferenforestvalley.map","RootDesk/MyDesk/DataSet/world/DT_MapTrap.csv"]);
  const csv=readFileSync(join(candidate.candidateDir,"RootDesk/MyDesk/DataSet/world/DT_MapTrap.csv"),"utf8");expect(csv).toContain(["valley_coma","ferenforestvalley",...trap!.cell,...nextMax,trap!.abnormalityId].join(",")+",");
  const identity={candidateId:candidate.candidateId,mapName:"ferenforestvalley",baselineId:project.gameSync!.baselineId};expect(core.reviewCandidate(identity,paths).status).toBe("ready");expect(core.packageCandidate(identity,paths).bytes.subarray(0,2).toString()).toBe("PK");expect(watched.map(hash)).toEqual(before);
 });
});
