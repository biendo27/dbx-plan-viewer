import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'test',testMatch:'*.browser.js',workers:1,fullyParallel:false,use:{headless:true,viewport:{width:1440,height:900}},reporter:'list'});
