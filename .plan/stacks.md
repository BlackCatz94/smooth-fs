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
