# SmoothFS — Design & UX Guidelines

## 1. Context & Audience
- **Domain:** Healthcare (Puskesmas, Klinik, Hospitals).
- **Target Users:** Healthcare workers, administrative staff, doctors, and nurses (Ages 17–60).
- **Design Philosophy:** Clean, sterile, trustworthy, and highly accessible. The UI must be intuitive for older users who are accustomed to legacy Windows systems, while remaining modern and fast.

---

## 2. Library Restrictions (Non-Negotiable)

The folder tree UI must be built from scratch. This is a strict requirement and applies to all design/implementation decisions.

### Restricted (Do NOT use)
- `vue3-tree-vue`
- `sl-vue-tree`
- `vue-jstree`
- Vuetify `<v-treeview>`
- Element Plus `<el-tree>`
- PrimeVue `Tree` / `TreeTable`
- Quasar `QTree`
- Any similar pre-built tree/file-explorer component

### Allowed
- **Styling/UI primitives:** Tailwind CSS, Headless UI, Radix Vue, Lucide-Vue
- **State/utilities:** Pinia, VueUse
- **Fetching:** native `fetch` or Axios
- **Performance:** `vue-virtual-scroller` (recommended for large datasets)

### Design implication
- The left panel must use a **custom recursive component** (`FolderNode`) with explicit expand/collapse behavior.
- Virtualization is allowed and encouraged, but only as a rendering helper, not as a replacement for the tree logic itself.

---

## 3. Layout & Visual Diagram

The layout strictly follows a classic "Windows Explorer" paradigm, optimized for web.

```text
+-----------------------------------------------------------------------------+
|  [+] SmoothFS (Logo)   |  [<] [>] [^]  Breadcrumb > Path > Here   | [Search]|
+-----------------------------------------------------------------------------+
|                        |                                                    |
|  v [Folder] Documents  |  Name                    Date Modified     Size    |
|    > [Folder] 2024     | -------------------------------------------------- |
|    v [Folder] 2025     |  [Folder] Patients       Oct 12, 2025      --      |
|      [Folder] Q1       |  [Folder] Reports        Oct 10, 2025      --      |
|      [Folder] Q2       |  [File]   BPJS_Data.csv  Oct 01, 2025      2.4 MB  |
|  > [Folder] Images     |  [File]   Lab_Result.pdf Sep 28, 2025      1.1 MB  |
|  > [Folder] Backups    |                                                    |
|                        |                                                    |
|                        |                                                    |
|                        |                                                    |
+-----------------------------------------------------------------------------+
|  3 Folders, 12 Files   |  Selected: BPJS_Data.csv (2.4 MB)                  |
+-----------------------------------------------------------------------------+
```

### Layout Components
1. **Top Navigation Bar:** Contains navigation controls (Back, Forward, Up), a Breadcrumb trail for context, and a global Search bar.
2. **Left Panel (Directory Tree):** The custom recursive tree. Used strictly for hierarchical navigation.
3. **Right Panel (Content View):** Displays the contents of the currently selected folder. Supports List (default for data-heavy health records) and Grid views.
4. **Status Bar:** Shows item counts and current selection details.

---

## 4. UX Behaviors (Windows Explorer Paradigm)

To ensure familiarity for clinical staff used to Windows environments:

- **Separation of Selection and Expansion (Left Panel):**
  - Clicking the **Chevron/Arrow** expands or collapses the folder (fetches children) *without* changing the main view.
  - Clicking the **Folder Name/Icon** selects the folder and updates the Right Panel to show its contents.
- **Right Panel Interactions:**
  - **Single Click:** Selects an item (highlights it).
  - **Double Click:** 
    - On a folder: Navigates into it (updates Breadcrumb, Left Panel selection, and Right Panel contents).
    - On a file: Opens/Previews the file.
- **Keyboard Navigation:**
  - `Up/Down` arrows to move selection.
  - `Enter` to open/navigate.
  - `Right Arrow` to expand folder (Left Panel).
  - `Left Arrow` to collapse folder (Left Panel).

---

## 5. Style Guidelines (Tailwind CSS)

Given the healthcare domain, the color palette should evoke cleanliness, trust, and calm (Blues, Teals, crisp Whites) with high contrast for older users.

### Colors
- **Primary (Brand/Action):** `sky-600` (`#0284c7`) - Trustworthy, clinical blue.
- **Background (App):** `slate-50` (`#f8fafc`) - Soft off-white to reduce eye strain during long shifts.
- **Surface (Panels/Cards):** `white` (`#ffffff`) - Crisp separation of content.
- **Text (Primary):** `slate-900` (`#0f172a`) - High contrast for readability.
- **Text (Secondary/Muted):** `slate-500` (`#64748b`) - For dates, sizes, and breadcrumbs.
- **Selection State (Active):** `sky-100` (`#e0f2fe`) background with `sky-900` text.
- **Hover State:** `slate-100` (`#f1f5f9`).

### Typography
- **Font Family:** `Inter`, `Roboto`, or system sans-serif.
- **Base Size:** `15px` or `16px` (slightly larger than standard 14px to accommodate 40-60 year old users).
- **Weights:** Regular (400) for standard text, Medium (500) for folder names/headers, Semibold (600) for active states.

### Spacing & Sizing
- **Touch Targets:** Minimum `32px` height for tree rows and list items to prevent misclicks by older users or on clinic tablets.
- **Density:** "Comfortable" by default. Avoid overly compact views unless explicitly toggled by the user.

### Icons (Lucide-Vue)
- **Folders:** `Folder`, `FolderOpen` (Fill with a soft yellow/blue or keep outlined based on preference).
- **Files:** `FileText`, `Image`, `FileSpreadsheet` (Differentiate file types clearly).
- **Controls:** `ChevronRight`, `ChevronDown` (for tree toggles - easier to click than tiny +/- boxes).

---

## 6. Accessibility (A11y) & Performance

- **Contrast:** Ensure text against selection backgrounds passes WCAG AA contrast ratios.
- **Focus Rings:** Visible `ring-2 ring-sky-500` on keyboard focus. Never remove outlines without providing a fallback.
- **Smoothness:** The UI must never freeze when expanding a folder with 10,000 patient records. The design relies on `vue-virtual-scroller` to keep the DOM light, ensuring the "clinical" feel isn't ruined by sluggish performance.