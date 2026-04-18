import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from '@/components/App.vue';
import { router } from '@/router';
import { loadEnv } from '@/lib/env';
import './style.css';

loadEnv();

createApp(App).use(createPinia()).use(router).mount('#app');
