<script setup lang="ts">
/**
 * SmoothFS brand mark. Inlined as an SVG component (not `<img>`) so the
 * gradient and strokes pick up `currentColor`-adjacent theming cleanly and
 * the icon scales without network fetches. Mirrors `public/favicon.svg`; if
 * you change this, update the favicon too so the two stay in sync.
 */
defineProps<{
  size?: number | string;
  title?: string;
}>();
</script>

<template>
  <svg
    :width="size ?? 28"
    :height="size ?? 28"
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    role="img"
    :aria-label="title ?? 'SmoothFS'"
  >
    <defs>
      <linearGradient
        id="sfs-grad"
        x1="0"
        y1="0"
        x2="32"
        y2="32"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#34d399" />
        <stop
          offset="1"
          stop-color="#059669"
        />
      </linearGradient>
    </defs>
    <rect
      x="1.5"
      y="1.5"
      width="29"
      height="29"
      rx="7"
      fill="url(#sfs-grad)"
    />
    <path
      d="M7.5 12.5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.41.59l1 1a2 2 0 0 0 1.42.58h5.27a2 2 0 0 1 2 2V22.5a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2v-10Z"
      fill="#ffffff"
      fill-opacity="0.14"
    />
    <path
      d="M6 12a2 2 0 0 1 2-2h4.17a2 2 0 0 1 1.42.59l1 1a2 2 0 0 0 1.41.58H22a2 2 0 0 1 2 2V22a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V12Z"
      fill="#ffffff"
    />
    <path
      d="m12 17.5 2.2 2.2 4.8-4.8"
      stroke="url(#sfs-grad)"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
