<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const params = useRoute().params as { name: string }
const router = useRouter()
</script>

<template>
  <div>
    <div i-carbon-pedestrian text-4xl inline-block />
    <p>
      Hi, {{ params.name }}
    </p>
    <p text-sm op50>
      <em>Dynamic route!</em>
    </p>

    <div>
      <button text-sm btn m-3 mt-8 @click="router.back()">
        Back
      </button>
    </div>
  </div>
</template>
