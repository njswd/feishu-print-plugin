/**
 * 插件入口：把 React 应用挂载到容器
 * （官方 opdev create 模板的入口结构，直接覆盖模板里的同名文件即可）
 */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./print.css";

const container = document.getElementById("root") || document.body;
createRoot(container).render(<App />);
