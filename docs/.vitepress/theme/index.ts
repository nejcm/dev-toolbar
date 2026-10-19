import DefaultTheme from "vitepress/theme-without-fonts";
import type { Theme } from "vitepress";
import RecipeBuilder from "./RecipeBuilder.vue";

import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("RecipeBuilder", RecipeBuilder);
  },
} satisfies Theme;
