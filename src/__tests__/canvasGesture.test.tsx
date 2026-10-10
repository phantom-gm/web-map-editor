import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { cellToScreen } from "../lib/grid";
import { cellKey } from "../lib/cell";
import { markServerResourceImage } from "../lib/serverResourceImage";
import type { PaletteTile } from "../lib/palette";
import type { GamePreviewScene } from "../lib/gamePreview";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => undefined],
  useCallback: (callback: unknown) => callback,
}));
vi.mock("../store/editorStore", async importOriginal => {
  const actual = await importOriginal<typeof import("../store/editorStore")>();
  return { ...actual, useEditorStore: Object.assign((selector: (s: unknown) => unknown) => selector(actual.useEditorStore.getState()), actual.useEditorStore) };
});
vi.mock("../store/gamePreviewStore", async importOriginal => {
  const actual = await importOriginal<typeof import("../store/gamePreviewStore")>();
  return { ...actual, useGamePreviewStore: Object.assign((selector: (s: unknown) => unknown) => selector(actual.useGamePreviewStore.getState()), actual.useGamePreviewStore) };
});
vi.mock("../lib/gameWorkspace", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/gameWorkspace")>();
  return { ...actual, useWorkspaceSession: Object.assign((selector: (s: unknown) => unknown) => selector(actual.useWorkspaceSession.getState()), actual.useWorkspaceSession) };
});
vi.mock("../lib/useGamePreview", () => ({ useGamePreview: () => undefined }));
import { CanvasGrid } from "../components/CanvasGrid";
import { useEditorStore } from "../store/editorStore";
import { useGamePreviewStore } from "../store/gamePreviewStore";
import { useWorkspaceSession } from "../lib/gameWorkspace";

type EventFn = (event: Record<string, unknown>) => void;
function surface() {
  const listeners = new Map<string, Set<EventFn>>();
  return {
    addEventListener: (kind: string, fn: EventFn) => { if (!listeners.has(kind)) listeners.set(kind, new Set()); listeners.get(kind)!.add(fn); },
    removeEventListener: (kind: string, fn: EventFn) => listeners.get(kind)?.delete(fn),
    fire: (kind: string, fields: Record<string, unknown> = {}) => { for (const fn of [...listeners.get(kind) ?? []]) fn({preventDefault:()=>undefined, ...fields}); },
  };
}
let canvas: ReturnType<typeof surface>, win: ReturnType<typeof surface>, cleanups: Array<() => void>;
function mount() {
  // Mount the real component's effects and event handlers; drawing is intentionally outside this interaction test.
  const node = { ...canvas, style: {}, getBoundingClientRect: () => ({left:0,top:0}), getContext: () => null, focus:()=>undefined };
  canvas = node;
  const bind = (element: unknown): void => {
    if (!element || typeof element !== "object") return;
    const e = element as {type?:string;ref?:{current:unknown};props?:{children?:unknown;className?:string}};
    if (e.type === "canvas") e.ref!.current = node;
    if (e.props?.className === "canvas-wrap") e.ref!.current = {};
    const children = e.props?.children; if (Array.isArray(children)) children.forEach(bind); else bind(children);
  };
  bind(CanvasGrid());
  cleanups = hooks.effects.flatMap(effect => { const cleanup = effect(); return typeof cleanup === "function" ? [cleanup] : []; });
}
function pointer(x:number,y:number,extra:Record<string,unknown> = {}) {
  const [clientX,clientY] = cellToScreen(x,y,useEditorStore.getState().camera);
  return {clientX,clientY,button:0,target:canvas,...extra};
}
beforeEach(() => {
  hooks.effects = []; cleanups = []; canvas = surface(); win = surface();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", {...win, devicePixelRatio:1,setTimeout:()=>0,clearTimeout:()=>undefined});
  vi.stubGlobal("document", {querySelector:()=>null});
  vi.stubGlobal("ResizeObserver", class {observe(){} disconnect(){}});
  useEditorStore.getState().newProject();
  const tile = {name:"grass",ruid:"a".repeat(32),category:"foothold",url:"test-msw-image",img:{naturalWidth:256,naturalHeight:128,src:"test-msw-image"}} as PaletteTile; markServerResourceImage(tile);
  useEditorStore.setState({palette:[tile],activeIdx:0,activeTool:"brush",gameSync:undefined});
  useGamePreviewStore.setState({status:"idle",scene:null,comparisonEnabled:false,runtimePanel:null,showScene:true,showOverlays:false});
  useWorkspaceSession.setState({loading:false});
});
afterEach(() => { cleanups.reverse().forEach(fn=>fn());vi.unstubAllGlobals(); });
it("wheel zoom preserves and continues the live stroke as one undoable action", () => {
  mount();canvas.fire("mousedown",pointer(2,2));win.fire("mousemove",pointer(3,2));
  canvas.fire("wheel",pointer(3,2,{deltaY:-1}));
  expect(useEditorStore.getState().ground.has(cellKey(2,2))).toBe(true);
  win.fire("mousemove",pointer(4,2));win.fire("mouseup",pointer(4,2));
  expect(useEditorStore.getState().ground.size).toBe(3);expect(useEditorStore.getState().undoStack).toHaveLength(1);
  useEditorStore.getState().undo();expect(useEditorStore.getState().ground.size).toBe(0);
});
it("window blur finishes the painted stroke with undo history instead of erasing it", () => {
  mount();canvas.fire("mousedown",pointer(2,2));win.fire("mousemove",pointer(3,2));win.fire("blur");
  expect(useEditorStore.getState().ground.size).toBe(2);expect(useEditorStore.getState().undoStack).toHaveLength(1);
  useEditorStore.getState().undo();expect(useEditorStore.getState().ground.size).toBe(0);
});
it("Escape still cancels an unfinished stroke without consuming earlier history", () => {
  mount();canvas.fire("mousedown",pointer(2,2));win.fire("keydown",{key:"Escape",code:"Escape"});
  expect(useEditorStore.getState().ground.size).toBe(0);expect(useEditorStore.getState().undoStack).toHaveLength(0);
});
it("repeated Shift/Control keydowns preserve a linked blocked-cell marquee", () => {
  useEditorStore.setState({mapName:"fixture",activeTool:"cursor",gameSync:{version:1,mapName:"fixture",baselineId:"baseline"},blocked:new Set([cellKey(2,2),cellKey(3,3)])});
  useGamePreviewStore.setState({status:"ready",baselineId:"baseline",selectionMode:"blocked",scene:{
    baselineId:"baseline",mapName:"fixture",groundOrigin:[0,0],sprites:[],objects:[],monsters:[],portals:[],npcs:[],traps:[],spawn:null,
    report:{walkEditingSupported:true},constants:{TILE_W:2.56,TILE_H:1.28,ORIGIN_X:15,ORIGIN_Y:15,DEPTH_SCALE:.21875,PPU:100},
  } as GamePreviewScene});
  mount();canvas.fire("mousedown",pointer(1,1,{shiftKey:true}));
  win.fire("keydown",{key:"Shift",code:"ShiftLeft",repeat:true});win.fire("keydown",{key:"Control",code:"ControlLeft",repeat:true});
  win.fire("mousemove",pointer(4,4));win.fire("mouseup",pointer(4,4));
  expect(useEditorStore.getState().selectedBlockedCells.sort()).toEqual([cellKey(2,2),cellKey(3,3)]);
});
