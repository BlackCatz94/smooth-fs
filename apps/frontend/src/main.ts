import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from '@/components/App.vue';
import { loadEnv } from '@/lib/env';
import './style.css';

loadEnv();

createApp(App).use(createPinia()).mount('#app');
