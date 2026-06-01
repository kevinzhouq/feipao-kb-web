import assert from "node:assert/strict";
import { searchKnowledgeBase } from "../search.mjs";

const payload = {
  records: [
    {
      id: "1",
      type: "成绩/证书",
      question: "为什么没有收到成绩短信？",
      answer: "成绩信息会由组委会审核后统一发出。",
      followUp: "",
      note: ""
    },
    {
      id: "2",
      type: "下载/保存问题",
      question: "付费后点击下载，视频没有保存到相册",
      answer: "请检查是否已经授权相册权限。",
      followUp: "引导开启小程序相册权限",
      note: "小程序相册授权.mp4"
    }
  ]
};

assert.equal(searchKnowledgeBase(payload, { query: "成绩" })[0].id, "1");
assert.equal(searchKnowledgeBase(payload, { query: "相册", category: "下载/保存问题" })[0].id, "2");
assert.equal(searchKnowledgeBase(payload, { query: "相册", category: "成绩/证书" }).length, 0);
assert.equal(searchKnowledgeBase(payload, { query: "" }).length, 2);

console.log("search tests passed");
