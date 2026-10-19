<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { EXTENSIONS, FRAMEWORKS, buildRecipe } from "./recipe";
import type { ExtensionId, Framework } from "./recipe";

const framework = ref<Framework>("vite");
const selected = ref<ExtensionId[]>(["environment", "metrics", "command-menu", "diagnostics"]);
const lazy = ref(true);
const copied = shallowRef<{ key: string; ok: boolean } | null>(null);

const recipe = computed(() =>
  buildRecipe({ framework: framework.value, extensions: selected.value, lazy: lazy.value }),
);

async function copy(key: string, text: string) {
  const ok = await navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
  const state = { key, ok };
  copied.value = state;
  setTimeout(() => {
    if (copied.value === state) copied.value = null;
  }, 1500);
}

function copyLabel(key: string) {
  if (copied.value?.key !== key) return "Copy";
  return copied.value.ok ? "Copied" : "Copy failed";
}
</script>

<template>
  <div class="recipe">
    <fieldset>
      <legend>Framework</legend>
      <label v-for="option in FRAMEWORKS" :key="option.id" class="choice">
        <input v-model="framework" type="radio" name="recipe-framework" :value="option.id" />
        {{ option.name }}
      </label>
    </fieldset>

    <fieldset>
      <legend>Extensions</legend>
      <label v-for="ext in EXTENSIONS" :key="ext.id" class="choice extension">
        <input v-model="selected" type="checkbox" :value="ext.id" />
        <span>
          <strong>{{ ext.name }}</strong>
          <small
            >{{ ext.summary }}<template v-if="ext.peer"> · needs {{ ext.peer }}</template></small
          >
        </span>
      </label>
    </fieldset>

    <fieldset>
      <legend>Production</legend>
      <label class="choice">
        <input v-model="lazy" type="checkbox" />
        Lazy-load, and leave it out of the production bundle
      </label>
    </fieldset>

    <div class="block">
      <div class="block-head">
        <span>Install</span>
        <button type="button" @click="copy('install', recipe.install)">
          {{ copyLabel("install") }}
        </button>
      </div>
      <pre><code>{{ recipe.install }}</code></pre>
    </div>

    <div v-for="file in recipe.files" :key="file.path" class="block">
      <div class="block-head">
        <span>{{ file.path }}</span>
        <button type="button" @click="copy(file.path, file.code)">
          {{ copyLabel(file.path) }}
        </button>
      </div>
      <pre><code>{{ file.code }}</code></pre>
    </div>

    <ul v-if="recipe.notes.length" class="notes">
      <li v-for="note in recipe.notes" :key="note">{{ note }}</li>
    </ul>
  </div>
</template>

<style scoped>
.recipe {
  margin-top: 24px;
}

fieldset {
  margin: 0 0 20px;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: 8px;
  font-weight: 600;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 6px 0;
  cursor: pointer;
}

.choice input:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.extension {
  display: flex;
  align-items: flex-start;
  margin-right: 0;
}

.extension input {
  margin-top: 5px;
}

.extension small {
  display: block;
  color: var(--vp-c-text-2);
}

.block {
  margin: 16px 0;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  overflow: hidden;
}

.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.block-head button {
  padding: 2px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
}

.block-head button:hover {
  border-color: var(--vp-c-brand-1);
}

.block pre {
  margin: 0;
  padding: 12px 16px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: var(--vp-code-font-size);
  line-height: 1.6;
}

.notes {
  color: var(--vp-c-text-2);
}
</style>
