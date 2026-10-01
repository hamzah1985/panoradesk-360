import { create } from 'zustand';
import { Project, AppMode, Scene, Hotspot, HotspotStyleSettings } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { ExportOptions, ExportResult, getDesktopApi } from '../lib/desktop';
import { useUiStore } from './uiStore';
import { normalizeHotspotIconId } from '../lib/hotspotIcons';

interface ProjectState {
  project: Project | null;
  historyPast: Project[];
  historyFuture: Project[];
  currentMode: AppMode;
  currentSceneId: string | null;
  selectedId: string | null;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedModifiedDate: string | null;
  lastSavedAt: string | null;
  setMode: (mode: AppMode) => void;
  setProject: (project: Project | null) => void;
  createNewProject: (name: string, path?: string) => void;
  addScene: (scene: Omit<Scene, 'id' | 'hotspots' | 'markers'>) => void;
  duplicateScene: (id: string) => void;
  moveScene: (id: string, direction: 'up' | 'down') => void;
  moveSceneToIndex: (id: string, targetIndex: number) => void;
  moveScenesToIndex: (ids: string[], targetIndex: number) => void;
  updateScene: (id: string, updates: Partial<Scene>) => void;
  updateSceneOrientation: (id: string, yaw: number, pitch: number) => void;
  deleteScene: (id: string) => void;
  deleteScenes: (ids: string[]) => void;
  setCurrentScene: (id: string) => void;
  setSelectedId: (id: string | null) => void;
  updateProject: (updates: Partial<Project>) => void;
  addHotspot: (sceneId: string, hotspot: any, options?: { createReverse?: boolean }) => void;
  updateHotspot: (sceneId: string, hotspotId: string, updates: any) => void;
  addMarker: (sceneId: string, marker: any) => void;
  updateMarker: (sceneId: string, markerId: string, updates: any) => void;
  deleteObject: (sceneId: string, objectId: string) => void;
  deleteObjectAndLinked: (sceneId: string, objectId: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  saveProject: () => Promise<void>;
  flushProject: () => Promise<void>;
}

const LS_KEY = 'panoradesk_projects';

// All renderer save entry points share this queue. Without it, autosave,
// Ctrl/Cmd+S, and the top-bar button can write snapshots concurrently and an
// older request that happens to finish last can replace newer project data.
let saveQueue: Promise<void> = Promise.resolve();
let saveRequestSequence = 0;
let activeProjectSession = 0;
const latestSaveRequestByProject = new Map<string, { requestId: number; session: number }>();
const pendingSnapshotSaves = new WeakMap<Project, { session: number; promise: Promise<void> }>();
const deletingProjectIds = new Set<string>();
let projectOperationSequence = 0;
const pendingProjectOperations = new Map<number, {
  projectId: string;
  session: number;
  promise: Promise<unknown>;
}>();

export type ProjectSessionToken = Readonly<{ projectId: string; session: number }>;

export function captureProjectSession(projectId: string): ProjectSessionToken {
  return { projectId, session: activeProjectSession };
}

export function ownsProjectSession(owner: ProjectSessionToken) {
  return owner.session === activeProjectSession
    && useProjectStore.getState().project?.id === owner.projectId;
}

export function runProjectOperation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const operationId = ++projectOperationSequence;
  const session = activeProjectSession;
  // Deferring the callback by one microtask lets us publish the registry entry
  // before any asynchronous operation can mutate the live project.
  const promise = Promise.resolve().then(operation);
  pendingProjectOperations.set(operationId, { projectId, session, promise });
  const clear = () => {
    const pending = pendingProjectOperations.get(operationId);
    if (pending?.promise === promise) pendingProjectOperations.delete(operationId);
  };
  void promise.then(clear, clear);
  return promise;
}

export function hasPendingProjectOperations(projectId: string) {
  return Array.from(pendingProjectOperations.values()).some((pending) => (
    pending.projectId === projectId && pending.session === activeProjectSession
  ));
}

async function waitForProjectOperations(projectId: string, session: number) {
  while (true) {
    const operations = Array.from(pendingProjectOperations.values())
      .filter((pending) => pending.projectId === projectId && pending.session === session)
      .map((pending) => pending.promise);
    if (operations.length === 0) return;
    await Promise.all(operations);
  }
}

// Content fingerprint of the project as last loaded or successfully saved in the
// current session. flushProject uses it to skip writes when nothing changed.
let savedContentBaseline: { session: number; projectId: string; fingerprint: string } | null = null;

function persistedProjectFingerprint(project: Project) {
  // The desktop save assigns the canonical folder and write timestamp. Those
  // are save results, not unsaved editor content, so they must not cause the
  // flush loop to write the same snapshot a second time.
  const { modifiedDate: _modifiedDate, path: _path, ...content } = project;
  return JSON.stringify(content);
}

function defaultExportSettings(title: string) {
  return {
    title,
    description: '',
    includeBranding: false,
    allowFullscreen: true,
    showSceneMenu: true,
    showGallery: true,
    showFloorPlan: false,
    exportTemplate: 'minimal' as const,
    imageOptimization: 'balanced' as const,
    showLoadingScreen: false,
  };
}

function defaultBrandingSettings(primaryColor: string) {
  return {
    companyName: '',
    websiteUrl: '',
    logoPath: undefined,
    primaryColor,
    secondaryColor: '#111827',
    showBranding: true,
  };
}

async function listProjectsFallback(): Promise<Project[]> {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set<string>();
    let changed = false;
    const projects = (parsed as Project[]).map((project) => {
      let id = String(project?.id || '');
      if (!id || seenIds.has(id)) {
        id = uuidv4();
        changed = true;
      }
      seenIds.add(id);
      return id === project.id ? project : { ...project, id };
    });
    if (changed) localStorage.setItem(LS_KEY, JSON.stringify(projects));
    return projects;
  } catch {
    return [];
  }
}

async function saveProjectFallback(project: Project): Promise<Project> {
  const projects = await listProjectsFallback();
  const next = projects.filter((p) => p.id !== project.id);
  const payload = { ...project, modifiedDate: new Date().toISOString() };
  next.unshift(payload);
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return payload;
}

export async function listProjects(): Promise<Project[]> {
  const desktop = getDesktopApi();
  if (desktop) return desktop.listProjects();
  return listProjectsFallback();
}

export async function deleteProject(projectId: string, projectPath?: string): Promise<boolean> {
  if (deletingProjectIds.has(projectId)) return false;
  deletingProjectIds.add(projectId);
  let removed = false;
  try {
    const runDelete = async () => {
      const desktop = getDesktopApi();
      if (desktop) return desktop.deleteProject(projectId, projectPath);
      const projects = await listProjectsFallback();
      const next = projects.filter((p) => p.id !== projectId);
      if (next.length === projects.length) return false;
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return true;
    };
    const deletePromise = saveQueue.then(runDelete, runDelete);
    saveQueue = deletePromise.then(() => {}, () => {});
    removed = await deletePromise;
    return removed;
  } finally {
    // Keep a successfully deleted ID blocked so a stale component cannot
    // recreate it. Failed/cancelled deletion remains retryable.
    if (!removed) deletingProjectIds.delete(projectId);
  }
}

export async function openProjectFromDialog(): Promise<Project | null> {
  const desktop = getDesktopApi();
  if (!desktop) return null;
  try {
    return await desktop.openProjectDialog();
  } catch {
    useUiStore.getState().pushToast('error', 'Unable to open the selected project file');
    return null;
  }
}

export async function checkProjectHealth(project: Project, options?: Partial<ExportOptions>) {
  const desktop = getDesktopApi();
  if (!desktop) return { ok: true, issues: [], warnings: [] };
  return desktop.checkProjectHealth(project, options);
}

export async function exportProjectWebsite(project: Project, options: ExportOptions): Promise<ExportResult | null> {
  const desktop = getDesktopApi();
  if (!desktop) return null;
  const result = await desktop.exportWebProject(project, options);
  if (result.canceled && result.notes) useUiStore.getState().pushToast('info', result.notes);
  return result;
}

export async function previewExport(project: Project, options: ExportOptions): Promise<void> {
  const desktop = getDesktopApi();
  if (!desktop) return;
  await desktop.previewWebExport(project, options);
}

export async function getInlinePreviewUrl(project: Project, options: ExportOptions): Promise<string | null> {
  const desktop = getDesktopApi();
  if (!desktop) return null;
  const result = await desktop.getInlinePreviewUrl(project, options);
  return result?.url ?? null;
}

export async function releaseInlinePreview(): Promise<void> {
  const desktop = getDesktopApi();
  if (!desktop?.releaseInlinePreview) return;
  try {
    await desktop.releaseInlinePreview();
  } catch {
    // Best-effort lifecycle cleanup. The main process also removes every live
    // preview synchronously before quit.
  }
}

export async function openPathInFileManager(targetPath: string): Promise<boolean> {
  const desktop = getDesktopApi();
  if (!desktop) return false;
  return desktop.openPathInFileManager(targetPath);
}

export async function renameProjectInList(projectId: string, newName: string, projectPath?: string): Promise<boolean> {
  if (deletingProjectIds.has(projectId)) return false;
  try {
    const persistRename = async () => {
      if (deletingProjectIds.has(projectId)) throw new Error('Cannot rename a project while it is being deleted.');
      // Read after earlier editor saves have drained. Reading before awaiting
      // the queue can merge the new name into a stale full-project snapshot and
      // overwrite edits that the earlier save just committed.
      const projects = await listProjects();
      const normalizedWantedPath = String(projectPath || '').replace(/\\/g, '/').toLowerCase();
      const project = projects.find((candidate) => {
        if (candidate.id !== projectId) return false;
        if (!normalizedWantedPath) return true;
        return String(candidate.path || '').replace(/\\/g, '/').toLowerCase() === normalizedWantedPath;
      });
      if (!project) throw new Error('Project no longer exists.');
      const updated = {
        ...project,
        name: newName.trim() || project.name,
        modifiedDate: new Date().toISOString(),
      };
      const desktop = getDesktopApi();
      if (desktop) await desktop.saveProject(updated);
      else await saveProjectFallback(updated);
    };
    // Dashboard rename writes use the same renderer queue as editor saves, so
    // an older editor snapshot cannot arrive after and undo the new name.
    const renamePromise = saveQueue.then(persistRename, persistRename);
    saveQueue = renamePromise.catch(() => {});
    await renamePromise;
    return true;
  } catch {
    return false;
  }
}

function cloneScene(source: Scene): Scene {
  return { ...source, id: uuidv4(), name: `${source.name} Copy`, hotspots: source.hotspots.map((h) => ({ ...h, id: uuidv4() })), markers: source.markers.map((m) => ({ ...m, id: uuidv4() })) };
}

function hasFiniteYawPitch(value: any) {
  return Number.isFinite(value?.yaw) && Number.isFinite(value?.pitch);
}

function normalizeMarkerDraft(marker: any) {
  if (!hasFiniteYawPitch(marker)) return null;
  return {
    id: String(marker?.id || uuidv4()),
    type: 'info' as const,
    title: String(marker?.title || 'Info'),
    description: String(marker?.description || ''),
    yaw: Number(marker.yaw),
    pitch: Number(marker.pitch),
    link: marker?.link ? String(marker.link) : undefined,
  };
}

type HotspotAnimationValue = NonNullable<Hotspot['animation']>;
type HotspotNavigationMode = NonNullable<Hotspot['navigationMode']>;

function normalizeHotspotAnimation(value: any): HotspotAnimationValue {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'static') return 'ping';
  return raw as HotspotAnimationValue;
}

function normalizeHotspotOpacity(value: any) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.1;
  return Math.max(0, Math.min(1, num));
}

function normalizeHotspotIcon(value: any) {
  return normalizeHotspotIconId(value);
}

function normalizeHotspotSize(value: any, fallback = 40) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(18, Math.round(fallback));
  return Math.max(18, Math.round(num));
}

function normalizeHotspotBorderWidth(value: any, fallback = 5) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 4;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(1, Math.min(16, Math.round(safeFallback)));
  return Math.max(1, Math.min(16, Math.round(num)));
}

function normalizeHotspotFloorCurve(value: any, fallback = 0) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0, Math.min(100, Math.round(safeFallback)));
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeHotspotPulseSpeed(value: any, fallback = 4.0) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 4.0;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0.8, Math.min(4, Number(safeFallback.toFixed(2))));
  return Math.max(0.8, Math.min(4, Number(num.toFixed(2))));
}

function normalizeHotspotRingCount(value: any, fallback = 3) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 3;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(1, Math.min(5, Math.round(safeFallback)));
  return Math.max(1, Math.min(5, Math.round(num)));
}

function normalizeHotspotRingWidth(value: any, fallback = 60) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 60;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(30, Math.min(160, Math.round(safeFallback)));
  return Math.max(30, Math.min(160, Math.round(num)));
}

function normalizeHotspotNavigationMode(value: any): HotspotNavigationMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'original') return 'original';
  if (mode === 'marzipano') return 'marzipano';
  if (mode === 'pannellum') return 'pannellum';
  return 'marzipano';
}

function normalizeTransitionType(_value: any): 'fade' {
  return 'fade';
}

function normalizeTransitionDuration(value: any, fallback = 900) {
  const num = Number(value);
  const safe = Number.isFinite(num) ? num : fallback;
  return Math.max(150, Math.min(5000, Math.round(safe)));
}

function makeReverseHotspot(sourceScene: Scene, targetScene: Scene, hotspot: any): Hotspot {
  const sourceYaw = Number.isFinite(Number(hotspot?.yaw)) ? Number(hotspot.yaw) : 0;
  const sourcePitch = Number.isFinite(Number(hotspot?.pitch)) ? Number(hotspot.pitch) : 0;
  const sourceEntry = defaultEntryForScene(sourceScene);
  const reverseYaw = normalizeYaw(sourceYaw + Math.PI);
  const reversePitch = clampPitch(-sourcePitch);
  return {
    id: uuidv4(),
    linkedHotspotId: hotspot?.id ? String(hotspot.id) : undefined,
    type: 'navigation',
    label: `Go to ${sourceScene.name}`,
    targetSceneId: sourceScene.id,
    yaw: reverseYaw,
    pitch: reversePitch,
    targetYaw: sourceEntry.yaw,
    targetPitch: sourceEntry.pitch,
    transitionType: normalizeTransitionType(hotspot?.transitionType),
    transitionDuration: normalizeTransitionDuration(hotspot?.transitionDuration),
    customTargetView: hotspot?.customTargetView === true,
    navigationMode: normalizeHotspotNavigationMode(hotspot?.navigationMode),
    entryYaw: Number.isFinite(Number(hotspot?.yaw)) ? Number(hotspot.yaw) : undefined,
    entryPitch: Number.isFinite(Number(hotspot?.pitch)) ? Number(hotspot.pitch) : undefined,
    icon: normalizeHotspotIcon(hotspot?.icon),
    animation: normalizeHotspotAnimation(hotspot?.animation),
    color: hotspot?.color || '#ffffff',
    size: normalizeHotspotSize(hotspot?.size, 70),
    opacity: normalizeHotspotOpacity(hotspot?.opacity),
    borderWidth: normalizeHotspotBorderWidth(hotspot?.borderWidth, 5),
    floorCurve: normalizeHotspotFloorCurve((hotspot as any)?.floorCurve, 0),
    pulseSpeed: normalizeHotspotPulseSpeed((hotspot as any)?.pulseSpeed, 4.0),
    ringCount: normalizeHotspotRingCount((hotspot as any)?.ringCount, 3),
    ringWidth: normalizeHotspotRingWidth((hotspot as any)?.ringWidth, 60),
  };
}

function normalizeYaw(value: number) {
  let yaw = value;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  return yaw;
}

function clampPitch(value: number) {
  return Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, value));
}

function defaultEntryForScene(scene?: Scene | null) {
  return {
    yaw: normalizeYaw(Number.isFinite(Number(scene?.initialYaw)) ? Number(scene?.initialYaw) : 0),
    pitch: clampPitch(Number.isFinite(Number(scene?.initialPitch)) ? Number(scene?.initialPitch) : 0),
  };
}

function angularDistance(a: number, b: number) {
  return Math.abs(normalizeYaw(a - b));
}

function closeEnough(a: number, b: number, epsilon = 0.00001) {
  return Math.abs(a - b) <= epsilon;
}

function enforceHotspotIntegrity(project: Project): Project {
  const scenes = project.scenes.map((scene) => ({
    ...scene,
    hotspots: scene.hotspots.map((h) => ({ ...h })),
    markers: scene.markers.map((m) => ({ ...m })),
  }));
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const used = new Set<string>();

  for (const scene of scenes) {
    scene.hotspots = scene.hotspots.filter((hotspot: any) => {
      const targetScene = sceneById.get(String(hotspot?.targetSceneId || ''));
      if (!targetScene || targetScene.id === scene.id) return false;
      return true;
    }).map((hotspot: any) => {
      const targetScene = sceneById.get(String(hotspot?.targetSceneId || ''));
      const fallbackEntry = defaultEntryForScene(targetScene);
      const yaw = Number.isFinite(Number(hotspot?.yaw)) ? Number(hotspot.yaw) : 0;
      const pitch = Number.isFinite(Number(hotspot?.pitch)) ? Number(hotspot.pitch) : 0;
      const entryYaw = Number.isFinite(Number(hotspot?.entryYaw)) ? Number(hotspot.entryYaw) : undefined;
      const entryPitch = Number.isFinite(Number(hotspot?.entryPitch)) ? Number(hotspot.entryPitch) : undefined;
      let rawTargetYaw = Number.isFinite(Number(hotspot?.targetYaw))
        ? Number(hotspot.targetYaw)
        : (Number.isFinite(yaw) ? yaw : fallbackEntry.yaw);
      let rawTargetPitch = Number.isFinite(Number(hotspot?.targetPitch))
        ? Number(hotspot.targetPitch)
        : (Number.isFinite(pitch) ? pitch : fallbackEntry.pitch);
      return {
        ...hotspot,
        id: String(hotspot?.id || uuidv4()),
        targetSceneId: String(hotspot?.targetSceneId || ''),
        linkedHotspotId: hotspot?.linkedHotspotId ? String(hotspot.linkedHotspotId) : undefined,
        yaw: normalizeYaw(yaw),
        pitch: clampPitch(pitch),
        targetYaw: normalizeYaw(rawTargetYaw),
        targetPitch: clampPitch(rawTargetPitch),
        entryYaw: Number.isFinite(entryYaw) ? normalizeYaw(Number(entryYaw)) : undefined,
        entryPitch: Number.isFinite(entryPitch) ? clampPitch(Number(entryPitch)) : undefined,
        transitionType: normalizeTransitionType(hotspot?.transitionType),
        transitionDuration: normalizeTransitionDuration(hotspot?.transitionDuration),
        customTargetView: hotspot?.customTargetView === true,
        navigationMode: normalizeHotspotNavigationMode(hotspot?.navigationMode),
      };
    });
  }

  for (const sourceScene of scenes) {
    for (const sourceHotspot of sourceScene.hotspots as any[]) {
      const targetScene = sceneById.get(String(sourceHotspot?.targetSceneId || ''));
      if (!targetScene || targetScene.id === sourceScene.id) continue;

      const sourceYaw = Number.isFinite(Number(sourceHotspot?.yaw)) ? Number(sourceHotspot.yaw) : 0;
      const wantedReverseYaw = normalizeYaw(sourceYaw + Math.PI);
      const key = `${sourceScene.id}:${sourceHotspot.id}`;
      if (used.has(key)) continue;

      // Trust an explicit link first, then heal reverse-link metadata later.
      let best = targetScene.hotspots.find((h: any) => (
        h?.targetSceneId === sourceScene.id
        && String(h?.id || '') === String(sourceHotspot?.linkedHotspotId || '')
        && !used.has(`${targetScene.id}:${h.id}`)
      )) as any;

      if (!best) {
        best = targetScene.hotspots.find((h: any) => (
          h?.targetSceneId === sourceScene.id
          && String(h?.linkedHotspotId || '') === String(sourceHotspot.id)
          && !used.has(`${targetScene.id}:${h.id}`)
        )) as any;
      }

      if (!best) {
        const candidates = targetScene.hotspots
          .filter((h: any) => h?.targetSceneId === sourceScene.id)
          .map((h: any) => ({
            hotspot: h,
            score: angularDistance(Number.isFinite(Number(h?.yaw)) ? Number(h.yaw) : 0, wantedReverseYaw),
            preferred: String(h?.linkedHotspotId || '') === String(sourceHotspot.id),
            used: used.has(`${targetScene.id}:${h.id}`),
          }))
          .sort((a, b) => {
            if (a.used !== b.used) return a.used ? 1 : -1;
            if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
            return a.score - b.score;
          });
        best = candidates[0]?.hotspot;
      }

      // Do not auto-recreate deleted counterparts during integrity checks.
      // Reverse hotspots are created only when a hotspot is initially added.
      if (!best || used.has(`${targetScene.id}:${best.id}`)) {
        sourceHotspot.linkedHotspotId = undefined;
        used.add(key);
        continue;
      }

      sourceHotspot.linkedHotspotId = String(best.id);
      (best as any).linkedHotspotId = String(sourceHotspot.id);
      used.add(key);
      used.add(`${targetScene.id}:${best.id}`);
    }
  }

  return { ...project, scenes };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  historyPast: [],
  historyFuture: [],
  currentMode: AppMode.DASHBOARD,
  currentSceneId: null,
  selectedId: null,
  saveState: 'idle',
  savedModifiedDate: null,
  lastSavedAt: null,
  setMode: (mode) => set({ currentMode: mode }),
  setProject: (project) => {
    activeProjectSession += 1;
    if (!project) {
      set({
        project: null,
        historyPast: [],
        historyFuture: [],
        currentMode: AppMode.DASHBOARD,
        currentSceneId: null,
        selectedId: null,
        saveState: 'idle',
        savedModifiedDate: null,
        lastSavedAt: null,
      });
      return;
    }
    const safeProjectId = String(project.id || uuidv4());
    const safeName = String(project.name || 'Untitled Project');
    const safePrimaryColor = String(project.primaryColor || '#C8A96A');
    const safeCreatedDate = String(project.createdDate || new Date().toISOString());
    const safeModifiedDate = String(project.modifiedDate || safeCreatedDate);
    const safePath = project.path ? String(project.path) : undefined;
    const safeLogo = project.logo ? String(project.logo) : undefined;
    const safeFloorPlanImage = project.floorPlanImage ? String(project.floorPlanImage) : undefined;
    const safeScenes = Array.isArray(project.scenes) ? project.scenes : [];
    const rawSceneIds = safeScenes.map((scene) => String(scene?.id || '').trim());
    const usedSceneIds = new Set<string>();
    for (const rawId of rawSceneIds) {
      if (!rawId) continue;
      if (usedSceneIds.has(rawId)) {
        // A reference to a duplicated scene ID is inherently ambiguous. Do not
        // guess and silently retarget or delete navigation hotspots.
        throw new Error(`This project cannot be opened safely because scene ID "${rawId}" is duplicated.`);
      }
      usedSceneIds.add(rawId);
    }
    const allocateMissingId = (usedIds: Set<string>) => {
      let nextId = uuidv4();
      while (usedIds.has(nextId)) nextId = uuidv4();
      usedIds.add(nextId);
      return nextId;
    };
    const normalizedSceneIds = rawSceneIds.map((rawId) => rawId || allocateMissingId(usedSceneIds));
    const sceneIdByRawId = new Map<string, string>();
    const sceneIndexByRawId = new Map<string, number>();
    rawSceneIds.forEach((rawId, sceneIndex) => {
      if (!rawId) return;
      sceneIdByRawId.set(rawId, normalizedSceneIds[sceneIndex]);
      sceneIndexByRawId.set(rawId, sceneIndex);
    });
    const normalizedObjectIds = safeScenes.map((scene) => {
      const rawHotspots = Array.isArray(scene?.hotspots) ? scene.hotspots : [];
      const rawMarkers = Array.isArray(scene?.markers) ? scene.markers : [];
      const rawHotspotIds = rawHotspots.map((hotspot) => String(hotspot?.id || '').trim());
      const rawMarkerIds = rawMarkers.map((marker) => String(marker?.id || '').trim());
      const usedObjectIds = new Set<string>();
      for (const rawId of [...rawHotspotIds, ...rawMarkerIds]) {
        if (!rawId) continue;
        if (usedObjectIds.has(rawId)) {
          throw new Error(
            `This project cannot be opened safely because object ID "${rawId}" is duplicated in scene "${String(scene?.name || 'Untitled Scene')}".`,
          );
        }
        usedObjectIds.add(rawId);
      }
      const hotspotIds = rawHotspotIds.map((rawId) => rawId || allocateMissingId(usedObjectIds));
      const markerIds = rawMarkerIds.map((rawId) => rawId || allocateMissingId(usedObjectIds));
      const hotspotIdByRawId = new Map<string, string>();
      rawHotspotIds.forEach((rawId, hotspotIndex) => {
        if (rawId) hotspotIdByRawId.set(rawId, hotspotIds[hotspotIndex]);
      });
      return { hotspotIds, markerIds, hotspotIdByRawId };
    });
    const safeExportSettings = {
      ...defaultExportSettings(safeName),
      ...(project.exportSettings || {}),
      title: String(project.exportSettings?.title || safeName),
    };
    const safeBrandingSettings = {
      ...defaultBrandingSettings(safePrimaryColor),
      ...(project.brandingSettings || {}),
      primaryColor: String(project.brandingSettings?.primaryColor || safePrimaryColor),
    };
    const safeHotspotStyle = (project.hotspotStyle || {}) as Partial<HotspotStyleSettings>;
    const normalizedProject: Project = {
      ...project,
      id: safeProjectId,
      name: safeName,
      company: String(project.company || ''),
      website: String(project.website || ''),
      createdDate: safeCreatedDate,
      modifiedDate: safeModifiedDate,
      path: safePath,
      logo: safeLogo,
      floorPlanImage: safeFloorPlanImage,
      primaryColor: safePrimaryColor,
      exportSettings: safeExportSettings,
      brandingSettings: safeBrandingSettings,
      hotspotStyle: {
        ...safeHotspotStyle,
        iconType: normalizeHotspotIcon(safeHotspotStyle.iconType),
        color: safeHotspotStyle.color || '#ffffff',
        size: normalizeHotspotSize(safeHotspotStyle.size, 70),
        borderWidth: normalizeHotspotBorderWidth((safeHotspotStyle as any).borderWidth, 5),
        floorCurve: normalizeHotspotFloorCurve((safeHotspotStyle as any).floorCurve, 0),
        pulseSpeed: normalizeHotspotPulseSpeed((safeHotspotStyle as any).pulseSpeed, 4.0),
        ringCount: normalizeHotspotRingCount((safeHotspotStyle as any).ringCount, 3),
        ringWidth: normalizeHotspotRingWidth((safeHotspotStyle as any).ringWidth, 60),
        animation: normalizeHotspotAnimation(safeHotspotStyle.animation),
        opacity: normalizeHotspotOpacity(safeHotspotStyle.opacity),
      },
      scenes: safeScenes.map((scene, sceneIndex) => {
        const rawHotspots = Array.isArray(scene?.hotspots) ? scene.hotspots : [];
        const rawMarkers = Array.isArray(scene?.markers) ? scene.markers : [];
        return {
          ...scene,
          id: normalizedSceneIds[sceneIndex],
          name: String(scene?.name || 'Untitled Scene'),
          image: String(scene?.image || ''),
          thumbnail: String(scene?.thumbnail || scene?.image || ''),
          initialYaw: Number.isFinite(scene?.initialYaw) ? scene.initialYaw : 0,
          initialPitch: Number.isFinite(scene?.initialPitch) ? scene.initialPitch : 0,
          initialZoom: Number.isFinite(scene?.initialZoom) ? scene.initialZoom : 20,
          hotspots: rawHotspots.map((hotspot, hotspotIndex) => {
            const rawTargetSceneId = String(hotspot?.targetSceneId || '').trim();
            const rawLinkedHotspotId = String(hotspot?.linkedHotspotId || '').trim();
            const targetSceneIndex = sceneIndexByRawId.get(rawTargetSceneId);
            const normalizedLinkedHotspotId = targetSceneIndex === undefined
              ? rawLinkedHotspotId
              : normalizedObjectIds[targetSceneIndex].hotspotIdByRawId.get(rawLinkedHotspotId)
                ?? rawLinkedHotspotId;
            return {
              ...hotspot,
              id: normalizedObjectIds[sceneIndex].hotspotIds[hotspotIndex],
              linkedHotspotId: normalizedLinkedHotspotId || undefined,
              label: String(hotspot?.label || 'Go to...'),
              targetSceneId: sceneIdByRawId.get(rawTargetSceneId) ?? rawTargetSceneId,
              yaw: Number.isFinite(hotspot?.yaw) ? hotspot.yaw : 0,
              pitch: Number.isFinite(hotspot?.pitch) ? hotspot.pitch : 0,
              targetYaw: Number.isFinite(hotspot?.targetYaw) ? hotspot.targetYaw : undefined,
              targetPitch: Number.isFinite(hotspot?.targetPitch) ? hotspot.targetPitch : undefined,
              transitionType: normalizeTransitionType(hotspot?.transitionType),
              transitionDuration: normalizeTransitionDuration(hotspot?.transitionDuration),
              customTargetView: hotspot?.customTargetView === true,
              navigationMode: normalizeHotspotNavigationMode(hotspot?.navigationMode),
              entryYaw: Number.isFinite(hotspot?.entryYaw) ? hotspot.entryYaw : undefined,
              entryPitch: Number.isFinite(hotspot?.entryPitch) ? hotspot.entryPitch : undefined,
              icon: normalizeHotspotIcon(hotspot?.icon || safeHotspotStyle.iconType),
              color: hotspot?.color || safeHotspotStyle.color || '#ffffff',
              size: normalizeHotspotSize(hotspot?.size, safeHotspotStyle.size as any),
              borderWidth: normalizeHotspotBorderWidth((hotspot as any)?.borderWidth, (safeHotspotStyle as any).borderWidth as any),
              floorCurve: normalizeHotspotFloorCurve((hotspot as any)?.floorCurve, (safeHotspotStyle as any).floorCurve as any),
              pulseSpeed: normalizeHotspotPulseSpeed((hotspot as any)?.pulseSpeed, (safeHotspotStyle as any).pulseSpeed as any),
              ringCount: normalizeHotspotRingCount((hotspot as any)?.ringCount, (safeHotspotStyle as any).ringCount as any),
              ringWidth: normalizeHotspotRingWidth((hotspot as any)?.ringWidth, (safeHotspotStyle as any).ringWidth as any),
              animation: normalizeHotspotAnimation(hotspot?.animation),
              opacity: normalizeHotspotOpacity(hotspot?.opacity),
            };
          }),
          markers: rawMarkers.map((marker, markerIndex) => ({
            ...marker,
            id: normalizedObjectIds[sceneIndex].markerIds[markerIndex],
            title: String(marker?.title || 'Info'),
            description: String(marker?.description || ''),
            yaw: Number.isFinite(marker?.yaw) ? marker.yaw : 0,
            pitch: Number.isFinite(marker?.pitch) ? marker.pitch : 0,
            link: marker?.link ? String(marker.link) : undefined,
          })),
        };
      }),
    };
    const linkedProject = enforceHotspotIntegrity(normalizedProject);
    set({
      project: linkedProject,
      historyPast: [],
      historyFuture: [],
      currentMode: AppMode.EDITOR,
      currentSceneId: linkedProject.scenes[0]?.id || null,
      selectedId: null,
      saveState: 'idle',
      savedModifiedDate: linkedProject.modifiedDate,
      lastSavedAt: null,
    });
    savedContentBaseline = {
      session: activeProjectSession,
      projectId: linkedProject.id,
      fingerprint: persistedProjectFingerprint(linkedProject),
    };
  },
  createNewProject: (name, path) => {
    activeProjectSession += 1;
    const nowIso = new Date().toISOString();
    set({
      project: {
        id: uuidv4(),
        name,
        company: '',
        website: '',
        primaryColor: '#C8A96A',
        scenes: [],
        createdDate: nowIso,
        modifiedDate: nowIso,
        ...(path ? { path } : {}),
        exportSettings: defaultExportSettings(name),
        brandingSettings: defaultBrandingSettings('#C8A96A'),
        hotspotStyle: { iconType: 'nav-default', color: '#ffffff', size: 70, borderWidth: 5, floorCurve: 0, pulseSpeed: 4.0, ringCount: 2, ringWidth: 60, opacity: 0.1, animation: 'ping', styleType: 'outline' },
      },
      historyPast: [],
      historyFuture: [],
      currentMode: AppMode.EDITOR,
      currentSceneId: null,
      selectedId: null,
      saveState: 'idle',
      // A new project is not a saved project until the first write actually
      // succeeds. This also lets autosave retry if that first write fails.
      savedModifiedDate: null,
      lastSavedAt: null,
    });
    // Persist immediately, while still allowing the store to expose failure via
    // saveState. This fire-and-forget caller deliberately consumes rejection;
    // awaited callers receive it from saveProject below.
    void get().saveProject().catch(() => {});
  },
  addScene: (sceneData) => { const { project, historyPast } = get(); if (!project) return; const newScene: Scene = { ...sceneData, id: uuidv4(), hotspots: [], markers: [] }; const newScenes = [...project.scenes, newScene]; set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes: newScenes, modifiedDate: new Date().toISOString() }, currentSceneId: project.scenes.length === 0 ? newScene.id : get().currentSceneId }); },
  duplicateScene: (id) => { const { project, historyPast } = get(); if (!project) return; const index = project.scenes.findIndex((s) => s.id === id); if (index < 0) return; const raw = cloneScene(project.scenes[index]); const copy = { ...raw, hotspots: raw.hotspots.map((h) => ({ ...h, linkedHotspotId: undefined })) }; const scenes = [...project.scenes]; scenes.splice(index + 1, 0, copy); const nextProject = enforceHotspotIntegrity({ ...project, scenes, modifiedDate: new Date().toISOString() }); set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: nextProject, currentSceneId: copy.id, selectedId: null }); },
  moveScene: (id, direction) => { const { project, historyPast } = get(); if (!project) return; const index = project.scenes.findIndex((s) => s.id === id); if (index < 0) return; const target = direction === 'up' ? index - 1 : index + 1; if (target < 0 || target >= project.scenes.length) return; const scenes = [...project.scenes]; const [item] = scenes.splice(index, 1); scenes.splice(target, 0, item); set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes, modifiedDate: new Date().toISOString() } }); },
  moveSceneToIndex: (id, targetIndex) => { const { project, historyPast } = get(); if (!project) return; const from = project.scenes.findIndex((s) => s.id === id); if (from < 0 || targetIndex < 0 || targetIndex >= project.scenes.length) return; const scenes = [...project.scenes]; const [item] = scenes.splice(from, 1); scenes.splice(targetIndex, 0, item); set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes, modifiedDate: new Date().toISOString() } }); },
  moveScenesToIndex: (ids, targetIndex) => { const { project, historyPast } = get(); if (!project) return; const idSet = new Set(ids); const selected = project.scenes.filter((s) => idSet.has(s.id)); const remaining = project.scenes.filter((s) => !idSet.has(s.id)); const clampedTarget = Math.max(0, Math.min(targetIndex, remaining.length)); const scenes = [...remaining.slice(0, clampedTarget), ...selected, ...remaining.slice(clampedTarget)]; set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes, modifiedDate: new Date().toISOString() } }); },
  updateScene: (id, updates) => {
    const { project, historyPast } = get();
    if (!project) return;
    const nextProject = enforceHotspotIntegrity({
      ...project,
      scenes: project.scenes.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      modifiedDate: new Date().toISOString(),
    });
    set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: nextProject });
  },
  updateSceneOrientation: (id, yaw, pitch) => { const { project, historyPast } = get(); if (!project) return; set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes: project.scenes.map((s) => (s.id === id ? { ...s, initialYaw: yaw, initialPitch: pitch } : s)), modifiedDate: new Date().toISOString() } }); },
  deleteScene: (id) => {
    const { project, historyPast, selectedId } = get();
    if (!project) return;
    const scenes = project.scenes
      .filter((s) => s.id !== id)
      .map((s) => ({ ...s, hotspots: s.hotspots.filter((h) => h.targetSceneId !== id) }));
    const selectedStillExists = scenes.some((s) => s.hotspots.some((h) => h.id === selectedId) || s.markers.some((m) => m.id === selectedId));
    const currentSceneId = get().currentSceneId;
    let nextCurrentSceneId = currentSceneId;
    if (currentSceneId === id) {
      const oldIndex = project.scenes.findIndex((s) => s.id === id);
      nextCurrentSceneId = scenes[oldIndex]?.id ?? scenes[oldIndex - 1]?.id ?? null;
    }
    set({
      historyPast: [...historyPast, project].slice(-100),
      historyFuture: [],
      project: enforceHotspotIntegrity({ ...project, scenes, modifiedDate: new Date().toISOString() }),
      currentSceneId: nextCurrentSceneId,
      selectedId: selectedStillExists ? selectedId : null,
    });
  },
  deleteScenes: (ids) => {
    const { project, historyPast, selectedId } = get();
    if (!project || ids.length === 0) return;
    const idSet = new Set(ids);
    const scenes = project.scenes
      .filter((s) => !idSet.has(s.id))
      .map((s) => ({ ...s, hotspots: s.hotspots.filter((h) => !idSet.has(h.targetSceneId)) }));
    const selectedStillExists = scenes.some((s) => s.hotspots.some((h) => h.id === selectedId) || s.markers.some((m) => m.id === selectedId));
    const currentSceneId = get().currentSceneId;
    let nextCurrentSceneId = currentSceneId;
    if (currentSceneId && idSet.has(currentSceneId)) {
      // Pick the nearest surviving scene relative to the current one in the
      // ORIGINAL ordering (scan forward, then back). Indexing the filtered array
      // with the old index is wrong when earlier scenes were also deleted.
      const oldIndex = project.scenes.findIndex((s) => s.id === currentSceneId);
      let survivor: string | null = null;
      for (let i = oldIndex + 1; i < project.scenes.length; i += 1) {
        if (!idSet.has(project.scenes[i].id)) { survivor = project.scenes[i].id; break; }
      }
      if (!survivor) {
        for (let i = oldIndex - 1; i >= 0; i -= 1) {
          if (!idSet.has(project.scenes[i].id)) { survivor = project.scenes[i].id; break; }
        }
      }
      nextCurrentSceneId = survivor;
    }
    set({
      historyPast: [...historyPast, project].slice(-100),
      historyFuture: [],
      project: enforceHotspotIntegrity({ ...project, scenes, modifiedDate: new Date().toISOString() }),
      currentSceneId: nextCurrentSceneId,
      selectedId: selectedStillExists ? selectedId : null,
    });
  },
  setCurrentScene: (id) => {
    const { project } = get();
    if (!project?.scenes.some((scene) => scene.id === id)) return;
    set({ currentSceneId: id, selectedId: null });
  },
  setSelectedId: (id) => set({ selectedId: id }),
  updateProject: (updates) => {
    const { project, historyPast } = get();
    if (!project) return;
    const nextUpdates: Partial<Project> = { ...updates };
    if (updates.hotspotStyle) {
      nextUpdates.hotspotStyle = {
        ...project.hotspotStyle,
        ...updates.hotspotStyle,
        iconType: normalizeHotspotIcon((updates.hotspotStyle as any).iconType ?? project.hotspotStyle.iconType),
        size: normalizeHotspotSize((updates.hotspotStyle as any).size ?? project.hotspotStyle.size, project.hotspotStyle.size),
        borderWidth: normalizeHotspotBorderWidth((updates.hotspotStyle as any).borderWidth ?? (project.hotspotStyle as any).borderWidth, (project.hotspotStyle as any).borderWidth ?? 5),
        floorCurve: normalizeHotspotFloorCurve((updates.hotspotStyle as any).floorCurve ?? (project.hotspotStyle as any).floorCurve, (project.hotspotStyle as any).floorCurve ?? 0),
        pulseSpeed: normalizeHotspotPulseSpeed((updates.hotspotStyle as any).pulseSpeed ?? (project.hotspotStyle as any).pulseSpeed, (project.hotspotStyle as any).pulseSpeed ?? 4.0),
        ringCount: normalizeHotspotRingCount((updates.hotspotStyle as any).ringCount ?? (project.hotspotStyle as any).ringCount, (project.hotspotStyle as any).ringCount ?? 3),
        ringWidth: normalizeHotspotRingWidth((updates.hotspotStyle as any).ringWidth ?? (project.hotspotStyle as any).ringWidth, (project.hotspotStyle as any).ringWidth ?? 60),
        animation: normalizeHotspotAnimation((updates.hotspotStyle as any).animation ?? project.hotspotStyle.animation),
        opacity: normalizeHotspotOpacity((updates.hotspotStyle as any).opacity ?? project.hotspotStyle.opacity),
      } as any;
    }
    const merged = { ...project, ...nextUpdates, modifiedDate: new Date().toISOString() };
    const nextProject = updates.scenes ? enforceHotspotIntegrity(merged) : merged;
    set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: nextProject });
  },
  addHotspot: (sceneId, hotspot, options) => {
    const { project } = get();
    if (!project) return;

    const sourceScene = project.scenes.find((s) => s.id === sceneId);
    if (!sourceScene) return;
    const createReverse = options?.createReverse !== false;
    const targetSceneId = String(hotspot?.targetSceneId || sceneId);
    const targetScene = project.scenes.find((s) => s.id === targetSceneId);
    const sourceYaw = Number.isFinite(Number(hotspot?.yaw)) ? Number(hotspot.yaw) : 0;
    const sourcePitch = Number.isFinite(Number(hotspot?.pitch)) ? Number(hotspot.pitch) : 0;
    const defaultAnimation = normalizeHotspotAnimation(project.hotspotStyle?.animation);
    const defaultSize = normalizeHotspotSize(project.hotspotStyle?.size, 70);
    const defaultBorderWidth = normalizeHotspotBorderWidth((project.hotspotStyle as any)?.borderWidth, 5);
    const defaultFloorCurve = normalizeHotspotFloorCurve((project.hotspotStyle as any)?.floorCurve, 0);
    const defaultPulseSpeed = normalizeHotspotPulseSpeed((project.hotspotStyle as any)?.pulseSpeed, 4.0);
    const defaultRingCount = normalizeHotspotRingCount((project.hotspotStyle as any)?.ringCount, 3);
    const defaultRingWidth = normalizeHotspotRingWidth((project.hotspotStyle as any)?.ringWidth, 60);

    const safeHotspot: Hotspot = {
      id: hotspot?.id || uuidv4(),
      linkedHotspotId: hotspot?.linkedHotspotId ? String(hotspot.linkedHotspotId) : undefined,
      type: 'navigation',
      label: hotspot?.label || 'Go to...',
      targetSceneId,
      yaw: sourceYaw,
      pitch: sourcePitch,
      targetYaw: Number.isFinite(hotspot?.targetYaw) ? hotspot.targetYaw : sourceYaw,
      targetPitch: Number.isFinite(hotspot?.targetPitch) ? hotspot.targetPitch : sourcePitch,
      transitionType: normalizeTransitionType(hotspot?.transitionType),
      transitionDuration: normalizeTransitionDuration(hotspot?.transitionDuration),
      customTargetView: hotspot?.customTargetView === true,
      navigationMode: normalizeHotspotNavigationMode(hotspot?.navigationMode),
      entryYaw: Number.isFinite(hotspot?.entryYaw) ? hotspot.entryYaw : undefined,
      entryPitch: Number.isFinite(hotspot?.entryPitch) ? hotspot.entryPitch : undefined,
      icon: normalizeHotspotIcon(hotspot?.icon || project.hotspotStyle?.iconType),
      animation: normalizeHotspotAnimation(hotspot?.animation ?? defaultAnimation),
      color: hotspot?.color || project.hotspotStyle?.color || '#ffffff',
      size: normalizeHotspotSize(hotspot?.size, defaultSize),
      opacity: normalizeHotspotOpacity(hotspot?.opacity ?? project.hotspotStyle?.opacity),
      borderWidth: normalizeHotspotBorderWidth((hotspot as any)?.borderWidth, defaultBorderWidth),
      floorCurve: normalizeHotspotFloorCurve((hotspot as any)?.floorCurve, defaultFloorCurve),
      pulseSpeed: normalizeHotspotPulseSpeed((hotspot as any)?.pulseSpeed, defaultPulseSpeed),
      ringCount: normalizeHotspotRingCount((hotspot as any)?.ringCount, defaultRingCount),
      ringWidth: normalizeHotspotRingWidth((hotspot as any)?.ringWidth, defaultRingWidth),
    };

    const nextScenes = project.scenes.map((s) => {
      if (s.id === sceneId) {
        return { ...s, hotspots: [...s.hotspots, safeHotspot] };
      }
      return s;
    });

    if (createReverse && targetScene && targetScene.id !== sourceScene.id) {
      const reverseExists = targetScene.hotspots.some((h: any) => (
        h.targetSceneId === sourceScene.id
        && h.linkedHotspotId
        && String(h.linkedHotspotId) === safeHotspot.id
      ));
      if (!reverseExists) {
        const reverseHotspot = makeReverseHotspot(sourceScene, targetScene, safeHotspot);
        safeHotspot.linkedHotspotId = reverseHotspot.id;
        for (let i = 0; i < nextScenes.length; i += 1) {
          if (nextScenes[i].id === targetScene.id) {
            nextScenes[i] = { ...nextScenes[i], hotspots: [...nextScenes[i].hotspots, reverseHotspot] };
            break;
          }
        }
      }
    }

    const nextProject = enforceHotspotIntegrity({
      ...project,
      scenes: nextScenes,
      modifiedDate: new Date().toISOString(),
    });
    set({ historyPast: [...get().historyPast, project].slice(-100), historyFuture: [], project: nextProject });
  },
  updateHotspot: (sceneId, hotspotId, updates) => {
    const { project, historyPast } = get();
    if (!project) return;
    const normalizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'animation')) {
      normalizedUpdates.animation = normalizeHotspotAnimation((normalizedUpdates as any).animation);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'opacity')) {
      normalizedUpdates.opacity = normalizeHotspotOpacity((normalizedUpdates as any).opacity);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'size')) {
      const nextSize = Number((normalizedUpdates as any).size);
      if (Number.isFinite(nextSize)) (normalizedUpdates as any).size = Math.max(18, Math.round(nextSize));
      else delete (normalizedUpdates as any).size;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'borderWidth')) {
      (normalizedUpdates as any).borderWidth = normalizeHotspotBorderWidth((normalizedUpdates as any).borderWidth, 5);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'floorCurve')) {
      (normalizedUpdates as any).floorCurve = normalizeHotspotFloorCurve((normalizedUpdates as any).floorCurve, 0);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'pulseSpeed')) {
      (normalizedUpdates as any).pulseSpeed = normalizeHotspotPulseSpeed((normalizedUpdates as any).pulseSpeed, 4.0);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'ringCount')) {
      (normalizedUpdates as any).ringCount = normalizeHotspotRingCount((normalizedUpdates as any).ringCount, 3);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'ringWidth')) {
      (normalizedUpdates as any).ringWidth = normalizeHotspotRingWidth((normalizedUpdates as any).ringWidth, 60);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'icon')) {
      (normalizedUpdates as any).icon = normalizeHotspotIcon((normalizedUpdates as any).icon);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'entryYaw')) {
      const nextYaw = Number((normalizedUpdates as any).entryYaw);
      if (Number.isFinite(nextYaw)) (normalizedUpdates as any).entryYaw = nextYaw;
      else delete (normalizedUpdates as any).entryYaw;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'entryPitch')) {
      const nextPitch = Number((normalizedUpdates as any).entryPitch);
      if (Number.isFinite(nextPitch)) (normalizedUpdates as any).entryPitch = nextPitch;
      else delete (normalizedUpdates as any).entryPitch;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'targetYaw')) {
      const nextYaw = Number((normalizedUpdates as any).targetYaw);
      if (Number.isFinite(nextYaw)) (normalizedUpdates as any).targetYaw = nextYaw;
      else delete (normalizedUpdates as any).targetYaw;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'targetPitch')) {
      const nextPitch = Number((normalizedUpdates as any).targetPitch);
      if (Number.isFinite(nextPitch)) (normalizedUpdates as any).targetPitch = nextPitch;
      else delete (normalizedUpdates as any).targetPitch;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'transitionType')) {
      (normalizedUpdates as any).transitionType = normalizeTransitionType((normalizedUpdates as any).transitionType);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'transitionDuration')) {
      (normalizedUpdates as any).transitionDuration = normalizeTransitionDuration((normalizedUpdates as any).transitionDuration);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'navigationMode')) {
      (normalizedUpdates as any).navigationMode = normalizeHotspotNavigationMode((normalizedUpdates as any).navigationMode);
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'customTargetView')) {
      (normalizedUpdates as any).customTargetView = (normalizedUpdates as any).customTargetView === true;
    }
    const nextScenes = project.scenes.map((s) => ({
      ...s,
      hotspots: s.hotspots.map((h) => ({ ...h })),
      markers: s.markers,
    }));
    const sourceScene = nextScenes.find((s) => s.id === sceneId);
    const sourceHotspot = sourceScene?.hotspots.find((h) => h.id === hotspotId) as any;
    if (!sourceScene || !sourceHotspot) return;

    Object.assign(sourceHotspot, normalizedUpdates);
    const targetSceneChanged = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'targetSceneId');
    if (targetSceneChanged && !Object.prototype.hasOwnProperty.call(normalizedUpdates, 'targetYaw')) {
      const newTargetScene = nextScenes.find((s) => s.id === sourceHotspot.targetSceneId);
      const newInitialYaw = newTargetScene && Number.isFinite(Number(newTargetScene.initialYaw)) ? Number(newTargetScene.initialYaw) : undefined;
      if (newInitialYaw !== undefined) sourceHotspot.targetYaw = newInitialYaw;
      else delete sourceHotspot.targetYaw;
      sourceHotspot.customTargetView = false;
    }
    if (targetSceneChanged && !Object.prototype.hasOwnProperty.call(normalizedUpdates, 'targetPitch')) {
      const newTargetScene = nextScenes.find((s) => s.id === sourceHotspot.targetSceneId);
      const newInitialPitch = newTargetScene && Number.isFinite(Number(newTargetScene.initialPitch)) ? Number(newTargetScene.initialPitch) : undefined;
      if (newInitialPitch !== undefined) sourceHotspot.targetPitch = newInitialPitch;
      else delete sourceHotspot.targetPitch;
    }

    const styleUpdates: Partial<HotspotStyleSettings> = {};
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'icon')) styleUpdates.iconType = (normalizedUpdates as any).icon;
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'color')) styleUpdates.color = String((normalizedUpdates as any).color || project.hotspotStyle.color || '#ffffff');
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'size')) styleUpdates.size = normalizeHotspotSize((normalizedUpdates as any).size, project.hotspotStyle.size);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'opacity')) styleUpdates.opacity = normalizeHotspotOpacity((normalizedUpdates as any).opacity);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'animation')) styleUpdates.animation = normalizeHotspotAnimation((normalizedUpdates as any).animation);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'borderWidth')) styleUpdates.borderWidth = normalizeHotspotBorderWidth((normalizedUpdates as any).borderWidth, (project.hotspotStyle as any).borderWidth ?? 5);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'floorCurve')) styleUpdates.floorCurve = normalizeHotspotFloorCurve((normalizedUpdates as any).floorCurve, (project.hotspotStyle as any).floorCurve ?? 0);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'pulseSpeed')) styleUpdates.pulseSpeed = normalizeHotspotPulseSpeed((normalizedUpdates as any).pulseSpeed, (project.hotspotStyle as any).pulseSpeed ?? 4.0);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'ringCount')) styleUpdates.ringCount = normalizeHotspotRingCount((normalizedUpdates as any).ringCount, (project.hotspotStyle as any).ringCount ?? 3);
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'ringWidth')) styleUpdates.ringWidth = normalizeHotspotRingWidth((normalizedUpdates as any).ringWidth, (project.hotspotStyle as any).ringWidth ?? 60);

    const nextProject = enforceHotspotIntegrity({
      ...project,
      scenes: nextScenes as any,
      hotspotStyle: {
        ...project.hotspotStyle,
        ...styleUpdates,
      },
      modifiedDate: new Date().toISOString(),
    });
    set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: nextProject });
  },
  addMarker: (sceneId, marker) => {
    const { project, historyPast } = get();
    if (!project) return;
    const normalizedMarker = normalizeMarkerDraft(marker);
    if (!normalizedMarker) return;
    set({
      historyPast: [...historyPast, project].slice(-100),
      historyFuture: [],
      project: {
        ...project,
        scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, markers: [...s.markers, normalizedMarker] } : s)),
        modifiedDate: new Date().toISOString(),
      },
    });
  },
  updateMarker: (sceneId, markerId, updates) => { const { project, historyPast } = get(); if (!project) return; set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes: project.scenes.map((s) => s.id === sceneId ? { ...s, markers: s.markers.map((m) => (m.id === markerId ? { ...m, ...updates } : m)) } : s), modifiedDate: new Date().toISOString() } }); },
  deleteObject: (sceneId, objectId) => {
    const { project, historyPast } = get();
    if (!project) return;
    const sourceScene = project.scenes.find((scene) => scene.id === sceneId);
    const objectExists = sourceScene?.hotspots.some((hotspot) => hotspot.id === objectId)
      || sourceScene?.markers.some((marker) => marker.id === objectId);
    if (!objectExists) return;
    const nextScenes = project.scenes.map((scene) => {
      if (scene.id === sceneId) {
        return {
          ...scene,
          hotspots: scene.hotspots.filter((h) => h.id !== objectId),
          markers: scene.markers.filter((m) => m.id !== objectId),
        };
      }
      // Keep paired return hotspots; only clear stale back-link references.
      return {
        ...scene,
        hotspots: scene.hotspots.map((h: any) => (
          String(h?.linkedHotspotId || '') === String(objectId)
            ? { ...h, linkedHotspotId: undefined }
            : h
        )),
      };
    });

    const nextProject = {
      ...project,
      scenes: nextScenes,
      modifiedDate: new Date().toISOString(),
    };
    set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: nextProject, selectedId: null });
  },
  deleteObjectAndLinked: (sceneId, objectId) => {
    const { project, historyPast } = get();
    if (!project) return;
    const sourceScene = project.scenes.find((s) => s.id === sceneId);
    const objectExists = sourceScene?.hotspots.some((hotspot) => hotspot.id === objectId)
      || sourceScene?.markers.some((marker) => marker.id === objectId);
    if (!objectExists) return;
    const sourceHotspot = sourceScene?.hotspots.find((h) => h.id === objectId) as any;
    const linkedId: string | undefined = sourceHotspot?.linkedHotspotId;
    const nextScenes = project.scenes.map((scene) => {
      if (scene.id === sceneId) {
        return { ...scene, hotspots: scene.hotspots.filter((h) => h.id !== objectId), markers: scene.markers.filter((m) => m.id !== objectId) };
      }
      if (linkedId && scene.hotspots.some((h) => h.id === linkedId)) {
        return { ...scene, hotspots: scene.hotspots.filter((h) => h.id !== linkedId) };
      }
      return { ...scene, hotspots: scene.hotspots.map((h: any) => (String(h?.linkedHotspotId || '') === String(objectId) ? { ...h, linkedHotspotId: undefined } : h)) };
    });
    set({ historyPast: [...historyPast, project].slice(-100), historyFuture: [], project: { ...project, scenes: nextScenes, modifiedDate: new Date().toISOString() }, selectedId: null });
  },
  undo: () => {
    const { project, historyPast, historyFuture } = get();
    if (!project || historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    set({
      project: previous,
      historyPast: historyPast.slice(0, -1),
      historyFuture: [project, ...historyFuture].slice(0, 100),
      selectedId: null,
      currentSceneId: previous.scenes.some((s) => s.id === get().currentSceneId) ? get().currentSceneId : (previous.scenes[0]?.id || null),
    });
  },
  redo: () => {
    const { project, historyPast, historyFuture } = get();
    if (!project || historyFuture.length === 0) return;
    const next = historyFuture[0];
    set({
      project: next,
      historyPast: [...historyPast, project].slice(-100),
      historyFuture: historyFuture.slice(1),
      selectedId: null,
      currentSceneId: next.scenes.some((s) => s.id === get().currentSceneId) ? get().currentSceneId : (next.scenes[0]?.id || null),
    });
  },
  canUndo: () => get().historyPast.length > 0,
  canRedo: () => get().historyFuture.length > 0,
  clearHistory: () => set({ historyPast: [], historyFuture: [] }),
  saveProject: async () => {
    const { project } = get();
    if (!project) return;
    if (deletingProjectIds.has(project.id)) {
      throw new Error('Cannot save a project while it is being deleted.');
    }

    const session = activeProjectSession;
    const existing = pendingSnapshotSaves.get(project);
    if (existing?.session === session) return existing.promise;

    const requestId = ++saveRequestSequence;
    latestSaveRequestByProject.set(project.id, { requestId, session });
    if (get().project === project && activeProjectSession === session) {
      set({ saveState: 'saving' });
    }

    const runSave = async () => {
      const desktop = getDesktopApi();
      try {
        if (deletingProjectIds.has(project.id)) {
          throw new Error('Cannot save a project while it is being deleted.');
        }
        const normalizedForSave = enforceHotspotIntegrity(project);
        const saved = desktop
          ? await desktop.saveProject(normalizedForSave)
          : await saveProjectFallback(normalizedForSave);
        const savedAt = new Date().toISOString();
        const latest = latestSaveRequestByProject.get(project.id);

        // A save from an editor/project session that is no longer active must
        // never change the newly opened project's status or dirty baseline.
        if (
          activeProjectSession === session
          && get().project?.id === project.id
          && latest?.requestId === requestId
          && latest.session === session
        ) {
          set((state) => {
            // Preserve edits made while the snapshot was being written. A
            // stale snapshot did reach disk, but it is not the current saved
            // baseline and must not make newer edits look saved.
            if (state.project !== project) {
              const currentPath = String(state.project?.path || '').replace(/\\/g, '/').toLowerCase();
              const snapshotPath = String(project.path || '').replace(/\\/g, '/').toLowerCase();
              const canAdoptSavedPath = !!saved.path && (!currentPath || currentPath === snapshotPath);
              return {
                project: canAdoptSavedPath
                  ? { ...state.project, path: saved.path }
                  : state.project,
                saveState: 'idle',
              };
            }
            // The saved snapshot is the live project: record it as the clean baseline.
            savedContentBaseline = { session, projectId: project.id, fingerprint: persistedProjectFingerprint(project) };
            return {
              project: { ...state.project, path: saved.path || state.project.path, modifiedDate: saved.modifiedDate },
              saveState: 'saved',
              savedModifiedDate: saved.modifiedDate,
              lastSavedAt: savedAt,
            };
          });
        }
      } catch (error) {
        const latest = latestSaveRequestByProject.get(project.id);
        if (
          activeProjectSession === session
          && get().project?.id === project.id
          && latest?.requestId === requestId
          && latest.session === session
        ) {
          set({ saveState: deletingProjectIds.has(project.id) ? 'idle' : 'error' });
        }
        throw error instanceof Error ? error : new Error(String(error || 'Failed to save project'));
      }
    };

    // Chain from both success and failure so one failed disk write cannot
    // poison the queue. Calls still receive their own rejection.
    const savePromise = saveQueue.then(runSave, runSave);
    saveQueue = savePromise.catch(() => {});
    pendingSnapshotSaves.set(project, { session, promise: savePromise });
    const clearPending = () => {
      const pending = pendingSnapshotSaves.get(project);
      if (pending?.session === session && pending.promise === savePromise) {
        pendingSnapshotSaves.delete(project);
      }
    };
    void savePromise.then(clearPending, clearPending);
    return savePromise;
  },
  flushProject: async () => {
    const firstProject = get().project;
    if (!firstProject) return;
    const session = activeProjectSession;
    const projectId = firstProject.id;

    // A save only owns the immutable snapshot it started with. Keep taking a
    // fresh snapshot after every completed write until no editor mutation
    // landed while that write was in flight.
    while (true) {
      await waitForProjectOperations(projectId, session);
      const snapshot = get().project;
      if (
        !snapshot
        || snapshot.id !== projectId
        || activeProjectSession !== session
      ) {
        throw new Error('The active project changed while its save was being flushed.');
      }
      // Nothing changed since the last successful save: do not rewrite the
      // manifest (bumps modifiedDate, and a failing disk would block closing).
      const fingerprint = persistedProjectFingerprint(snapshot);
      if (
        savedContentBaseline
        && savedContentBaseline.session === session
        && savedContentBaseline.projectId === projectId
        && savedContentBaseline.fingerprint === fingerprint
      ) return;
      await get().saveProject();
      // Imports/uploads can begin while the disk write is in flight. Wait for
      // their final store updates before deciding that the snapshot was stable.
      await waitForProjectOperations(projectId, session);

      const liveProject = get().project;
      if (
        !liveProject
        || liveProject.id !== projectId
        || activeProjectSession !== session
      ) {
        throw new Error('The active project changed while its save was being flushed.');
      }
      if (persistedProjectFingerprint(liveProject) === fingerprint) return;
    }
  },
}));
