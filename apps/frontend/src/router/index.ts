import { createRouter, createWebHistory } from 'vue-router';
import AppShell from '@/components/AppShell.vue';

/**
 * Single optional-param route per Phase 4 plan: `/folders/:id?`. The app shell
 * is the only view; the selected folder id flows through `route.params.id`.
 * `/` redirects to `/folders` so the URL is always on a canonical shape.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/folders' },
    {
      path: '/folders/:id?',
      name: 'folders',
      component: AppShell,
      props: true,
    },
  ],
});
