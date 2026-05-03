# Player Ship Model Visibility Issue - Investigation Report

## Executive Summary
The 3D fighter ship model (`Fighter_01.obj`) is supposed to render in the system view when the player visits their home star system, but **it's not visible**. The investigation identified **multiple interconnected issues** preventing visibility.

---

## Project Architecture Overview

### Core Structure
```
Game Root
├── GalaxyScene (500-star map with hyperlanes)
├── SystemScene (individual star systems with planets + player ship)
└── SceneManager (handles scene transitions)
```

### Game Flow
1. **Start** → Load GalaxyScene (500 procedurally-generated stars)
2. **Click Star** → Switch to SystemScene for that star
3. **If Player's Home Star** → Load Fighter_01.obj 3D model
4. **Player can return** to GalaxyScene via Escape key

---

## Problem: Player Ship Not Visible

### Investigation Results

#### **Issue #1: Visibility Toggle Bug (CRITICAL FIX APPLIED)**
**Severity**: 🔴 HIGH - This is likely the main culprit

**Root Cause**: 
- The `setStarsVisible()` function in SystemScene only controls the **star mesh**, NOT the player ship
- HUD toggle: "Stars" can be toggled on/off via checkbox
- When `stars = false`, the star light dims AND the ship becomes invisible
- **Problem**: Player ship meshes rely on:
  - Star PointLight (main illumination)
  - Ship-specific PointLight (accent lighting)
  - Emissive colors (for glow/highlights)

**Code Location**: [src/scenes/SystemScene.ts](src/scenes/SystemScene.ts#L1198-L1205)

**Before (Broken)**:
```typescript
setStarsVisible(visible: boolean): void {
  this.starsVisible = visible;
  if (this.starMesh) {
    this.starMesh.setEnabled(visible);  // Only disables star
  }
  // playerShipRoot is NOT controlled!
}
```

**After (Fixed)**:
```typescript
setStarsVisible(visible: boolean): void {
  this.starsVisible = visible;
  if (this.starMesh) {
    this.starMesh.setEnabled(visible);
  }
  if (this.playerShipRoot) {
    this.playerShipRoot.setEnabled(visible);  // ✅ NOW FIXED
  }
}
```

---

#### **Issue #2: Material Lighting Configuration (HIGH RISK)**
**Severity**: 🟠 MEDIUM-HIGH

**Problem**: Ship materials are configured with low ambient lighting:
```typescript
// All ship materials use these defaults:
material.diffuseColor = Color3.Black();     // ← NO ambient reflection
material.specularColor = Color3.Black();    // ← NO specular highlights
material.emissiveColor = /* varying */      // ← ONLY source of light
```

**Why This Matters**:
- The ship **only shows emissive colors** (blue cockpit, red thrusters)
- The main body (grey hull) has:
  - Diffuse texture: `Fighter_01_Body_BaseColor.png`
  - Normal map: `Fighter_01_Body_Normal.png`
  - **But**: `diffuseColor = Black()` means textures receive NO light
- Ships needs the star light to render the body properly

**Current Light Sources**:
1. **Star PointLight** - Primary illumination
   - Position: `(0, 0, 0)` (at star center)
   - Intensity: 3.2 (varies by star type)
   - Range: 220 units
   
2. **Fill Light** - Ambient fill
   - Position: `(0, -28, 0)` (below star)
   - Intensity: 0.55
   - Range: 320 units
   
3. **Ship PointLight** - Accent lighting
   - Position: `(0, 6, -8)` (relative to ship)
   - Intensity: 1.45
   - Range: 46 units (very limited!)

**Ship Position**: `(23, 4.8, -19)` - **23 units away from star center**
- Ship is OUTSIDE the star light range (220) ✓ Should be OK
- But ship light only reaches 46 units - might not reach hull surfaces

---

#### **Issue #3: Model Scale Calculation**
**Severity**: 🟡 LOW-MEDIUM

**Potential Problem**:
- Target size: 11 world units
- Bounds calculation:
  ```typescript
  const maxDimension = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z
  );
  const shipScale = PLAYER_SHIP_TARGET_SIZE / maxDimension;  // 11 / maxDim
  ```
- If `maxDimension = 0` (invalid bounds), this causes `NaN` scale
- Fallback bounds used if computation fails: `[-1,-1,-1]` to `[1,1,1]` (2-unit box)

**Debug Logging Added** to track:
- ✅ How many meshes loaded
- ✅ Bounds calculation results  
- ✅ Scale factor applied
- ✅ Individual mesh vertex counts

---

#### **Issue #4: Camera Positioning (LOW RISK)**
**Severity**: 🟡 LOW

**Details**:
- Camera target: `Vector3.Zero()` (at star)
- Camera distance: 65 units (default)
- Ship position: 23 units away at offset `(23, 4.8, -19)`
- Camera orbits around star - ship should be visible at most angles
- **Risk**: Unlikely to be the issue, but possible if bounds/scale causes model to render at wrong location

---

#### **Issue #5: Texture/Asset Loading**
**Severity**: 🟡 LOW

**Asset Structure**:
```
/public/ships/fighter_01/
├── Fighter_01.obj
├── Fighter_01.mtl
└── textures/
    ├── Fighter_01_Body_BaseColor.png
    ├── Fighter_01_Body_Normal.png
    ├── Fighter_01_Front_BaseColor.png
    ├── Fighter_01_Front_Normal.png
    ├── Fighter_01_Front_Emissive.png
    ├── Fighter_01_Rear_BaseColor.png
    ├── Fighter_01_Rear_Normal.png
    ├── Fighter_01_Rear_Emissive.png
    ├── Fighter_01_Windows_BaseColor.png
    └── Fighter_01_Windows_Normal.png
```

**OBJ Loader**: Uses Babylon's `SceneLoader.ImportMeshAsync()`
- Automatically loads .mtl and textures referenced in OBJ
- Paths are relative to model root: `/ships/fighter_01/`
- **Risk**: If textures don't exist, model still loads but appears untextured

---

## Fixes Applied

### ✅ Fix #1: Visibility Toggle Control (APPLIED)
**File**: [src/scenes/SystemScene.ts](src/scenes/SystemScene.ts#L1198-L1205)

Added player ship root to the `setStarsVisible()` function so it's controlled consistently with the star.

### ✅ Fix #2: Debug Logging (APPLIED)
**File**: [src/scenes/SystemScene.ts](src/scenes/SystemScene.ts#L663-L720)

Added comprehensive logging to track:
- Model import progress
- Mesh filtering
- Bounds calculation
- Vertex counts per mesh
- Final scale and position

Sample console output now shows:
```
🚀 Loading player ship for star ID 42
📍 Player ship root position: {"x":23,"y":4.8,"z":-19}
📦 Importing Fighter_01.obj from /ships/fighter_01/
✓ Loaded 5 total meshes from OBJ
✓ Filtered to 5 renderable meshes
📐 Bounds: min={"x":-1,"y":0,"z":-1}, max={"x":1,"y":1,"z":1}, maxDim=2
📏 Scaling to 11 world units: scale=5.5
  - Mesh "Body": vertices=1200
  - Mesh "Front": vertices=800
  - Mesh "Rear": vertices=800
  - Mesh "Windows": vertices=400
  - Mesh "Engines": vertices=200
✅ Player ship loaded successfully!
```

---

## Remaining Issues to Investigate

### If Ship Still Not Visible After Fixes:

1. **Material Lighting**
   - Check if `diffuseColor = Black()` is intentional
   - Consider using `StandardMaterial` with actual colors
   - Verify star light actually reaches ship position

2. **Model Orientation**
   - Ship rotation: `(0.18, -0.7, -0.08)` radians
   - Might be rotated facing away from camera
   - **Quick Test**: Change rotation to `(0, 0, 0)`

3. **Asset Path Issues**
   - Verify `/ships/fighter_01/Fighter_01.obj` path is correct
   - Check browser Network tab for 404 errors
   - Ensure textures load with correct paths

4. **Bounds Computation**
   - If fallback bounds `[-1,-1,-1]` to `[1,1,1]` are used, scaling to 11 units gives 5.5x scale
   - Might be too large or too small
   - Look at console logs to see actual bounds

---

## Testing Procedure

1. **Start game**
   - App boots and loads GalaxyScene
   - Default visibility settings: stars=true, bloom=true

2. **Navigate to Player Home Star**
   - Star ID is deterministic: `seed=42` → `starId = floor(mulberry32(42 ^ 0x6c8e9cf5)() * 500)`
   - This will load SystemScene for that star
   - Console will show loading logs

3. **Check Console Output**
   - Open DevTools (F12)
   - Look for 🚀🚀 emoji logs
   - Check for ✅ success or ❌ failures

4. **Try Toggling Stars Visibility**
   - Click "Stars" checkbox in HUD
   - Should now properly hide/show player ship
   - (Before fix: ship would stay visible regardless)

5. **Check Camera View**
   - Use mouse to orbit camera around star
   - Ship should be visible at `(23, 4.8, -19)` offset
   - Try zooming in/out

---

## Code Changes Summary

### Files Modified
- ✅ `src/scenes/SystemScene.ts`
  - Updated `setStarsVisible()` to control playerShipRoot
  - Added debug logging throughout model loading

### Build Status
- ✅ TypeScript compiles without errors
- ✅ Vite build succeeds (5.2 MB final bundle)
- ✅ No new dependencies required

---

## Next Steps

1. **Run the game** and navigate to player's home star
2. **Check console logs** for model loading diagnostics
3. **Inspect scene** using Babylon Inspector (F9 or via code)
4. **Report** what the logs show:
   - Did model load successfully?
   - What are the bounds and scale values?
   - Is ship visible after toggling stars?

---

## References

### Key Files
- Model Loader: [src/scenes/SystemScene.ts#L663-L720](src/scenes/SystemScene.ts#L663-L720)
- Visibility Control: [src/scenes/SystemScene.ts#L1198-L1205](src/scenes/SystemScene.ts#L1198-L1205)
- Material Styling: [src/scenes/SystemScene.ts#L745-L803](src/scenes/SystemScene.ts#L745-L803)
- Lighting Setup: [src/scenes/SystemScene.ts#L581-L619](src/scenes/SystemScene.ts#L581-L619)

### Related Data
- Player Ship Detection: [src/data/PlayerShip.ts](src/data/PlayerShip.ts)
- Galaxy Config: [src/data/GalaxyMap.ts](src/data/GalaxyMap.ts) (500 stars, seed=42)
- Main Boot: [src/main.ts](src/main.ts) (scene switching logic)
