# **Product Requirements Document: SmoothFS**

**Project Name:** SmoothFS

**Objective:** A high-performance, web-based Windows Explorer clone handling unlimited folder depth and massive datasets seamlessly.

## **1\. Technology Stack**

The following tech stack is strictly defined:

### **Infrastructure & Tooling**

* **Runtime Environment:** Bun.  
* **Repository Structure:** Bun Workspaces / Turborepo (Monorepo with neat structure).  
* **Language:** TypeScript strictly across the entire stack.

### **Database Layer**

* **Database:** PostgreSQL. (Chosen over MySQL/MariaDB for its superior handling of recursive queries via LTREE extension or Recursive CTEs, crucial for unlimited folder depth).  
* **ORM:** Drizzle ORM or Prisma. *Recommendation: Drizzle ORM for its lightweight nature and high performance with edge runtimes/Bun.*

### **Backend (API & Core Logic)**

* **Framework:** Elysia.js.  
* **Architecture Pattern:** Clean / Hexagonal Architecture (Clean/HexArch, Service & Repository layer, and SOLID principles).  
* **API Design:** RESTful API standards.  
  * *Implementation:* Proper use of HTTP verbs (GET, POST, PUT, DELETE), standard URI naming (e.g., /api/v1/folders), and semantic status codes.

### **Frontend (User Interface)**

* **Framework:** Vue 3 with Composition API (Strict Core Requirement).
* **Build Tool:** Vite (via Bun).
* **State Management:** Pinia (For handling complex UI state like selected folders and search results).
* **UI Components:** Tailwind CSS paired with Radix Vue or Headless UI. (Using UI components while keeping the tree completely custom).

### **Testing Suite**

* **Backend Unit & Integration:** Bun's native test runner (bun test).  
* **Frontend UI Unit Tests:** Vitest \+ Vue Test Utils.  
* **End-to-End (E2E) Tests:** Playwright.

## **2\. Restricted vs. Allowed Libraries**

The core constraint states (VERY IMPORTANT - must be strictly followed): *"Can use any libraries, EXCEPT the library to display folder structures or similar. You must build the folder structure display from scratch."*

### **🚫 RESTRICTED Libraries (Do NOT use these)**

To avoid instant disqualification, do not install or use any pre-built tree-view, file-explorer, or nested-list component libraries.

* vue3-tree-vue  
* sl-vue-tree  
* vue-jstree  
* Vuetify's \<v-treeview\>  
* Element Plus's \<el-tree\>  
* PrimeVue's Tree or TreeTable component  
* Quasar's QTree
* Other similar tree/view/list components

### **✅ ALLOWED Libraries**

* **Styling & Base Components:** Tailwind CSS, Headless UI, Radix Vue, Lucide-Vue (for folder/file icons).  
* **State & Fetching:** Pinia, VueUse, Axios (or native fetch).  
* **Virtualization:** vue-virtual-scroller (Highly recommended to hit the "Scalability / Millions of data" bonus point. It helps render the custom tree from scratch without lagging the DOM).

### **Maintainability of custom folder structure display**

The custom folder structure display should be maintainable and easy to update. It should be able to handle large amounts of data without lagging the DOM. Separate it like a custom library.

## **3\. Assessment Criteria Strategy**

The prompt explicitly states you will be assessed on four key areas. Here is how SmoothFS addresses them:

1. **How clean and clear your code is:** Enforced via strict ESLint/Prettier configurations, standard Monorepo folder structures, and distinct separation of concerns (Controllers vs. Services).  
2. **The data structure you choose:** Using the **Adjacency List Model** (id, parent\_id, name) in the database, mapped to strongly typed nested Tree Node interfaces in TypeScript.  
3. **The algorithm:** \* *Backend:* Utilizing Recursive CTEs (Common Table Expressions) in SQL to fetch unlimited depth efficiently.  
   * *Frontend:* Using a custom recursive Vue Component (\<FolderNode /\> calling itself) paired with Lazy Loading (fetching children only when a parent is expanded).  
4. **Best practices you implement:** SOLID principles (Single Responsibility, Dependency Inversion via Interfaces), robust error handling, and environment-variable-driven configuration.

Note: you are allowed to disageree with the prompt if you think it's not the best approach, confirm it to the user.

## **4\. Sequential Development Plan**

### **Phase 1: Foundation & Monorepo Setup**

1. Initialize a Monorepo using Bun Workspaces (/apps/frontend, /apps/backend, /packages/shared).  
2. Set up shared TypeScript interfaces (e.g., FolderNode, FileNode) in the shared package so both frontend and backend use the exact same types.

### **Phase 2: Database & Architecture Setup (Backend)**

1. Initialize PostgreSQL database.  
2. Implement ORM (Drizzle/Prisma) schemas. *Crucial: Choose the Adjacency List model (id, parent\_id, name) combined with Recursive CTEs for querying.*  
3. Scaffold the **Hexagonal Architecture**:  
   * Domain: Core business logic and entities.  
   * Ports/Repositories: Interfaces for data access.  
   * Adapters/Database: Actual ORM implementation.  
   * Services/Use Cases: Application logic.  
   * Controllers: Elysia HTTP route handlers.

### **Phase 3: Backend API & Scalability Implementation**

1. Develop standard REST endpoints (GET /api/v1/folders, GET /api/v1/folders/:id/children, etc.).  
2. **Scalability Features:**  
   * Implement **pagination** or **cursor-based loading** for folder contents.  
   * Implement a **Search Endpoint** (Hits Search Function bonus).  
   * Add basic **caching** (in-memory or Redis) for the initial full-tree load.

### **Phase 4: Frontend Development (The Tree UI)**

1. Scaffold Vue 3 application.  
2. **Left Panel (Folder Tree):** Build a *recursive Vue component* (\<FolderItem /\> that calls \<FolderItem /\> inside itself) to handle unlimited depth.  
3. Add state toggles to make folders openable/closable.  
4. **Right Panel (Sub-contents):** Fetch and display direct subfolders when a left-panel node is clicked.  
5. **Files Support:** Include files alongside folders in the database and display them in the right panel.

### **Phase 5: Testing & Polish**

1. Write Unit tests for backend services.  
2. Write UI Unit tests for the custom Recursive Tree Component.  
3. Write API Integration tests.  
4. Write a simple Playwright script covering the E2E flow (Load page \-\> click folder \-\> view subfolders \-\> search).

## **5\. Requirement Verification Checklist**

* \[x\] Split horizontal panels (Left: Tree, Right: Sub-contents).  
* \[x\] Initial load fetches complete folder structure.  
* \[x\] Unlimited subfolders & levels supported.  
* \[x\] DB is MySQL, MariaDB, or PostgreSQL (PostgreSQL selected).  
* \[x\] Backend serves API & loads DB.  
* \[x\] TypeScript utilized across stack.  
* \[x\] Vue 3 \+ Composition API utilized.  
* \[x\] Folder structure built 100% from scratch.  
* \[x\] Code structured cleanly via Solid Principles & Hex Arch.  
* \[x\] All 17 Bonus points accounted for in the architecture plan.