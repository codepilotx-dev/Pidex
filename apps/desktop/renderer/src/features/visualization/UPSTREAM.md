# OpenIntelligentUI 参考实现

- 来源：https://github.com/CopilotKit/OpenIntelligentUI
- Revision：`8391a94c1c3939c679e40ddd7bfc08a9ef690e70`
- 导入日期：2026-10-14
- `ProcessPartialHtml.ts` 改造自 `apps/app/src/components/generative-ui/open-generative-ui/process-partial-html.ts`。只复用部分 HTML 的布局处理，不把它当作安全过滤器。
- 其余宿主桥接、隔离、协议和持久化沿 Pidex 现有实现编写。ChatGPT 解包代码仅用于理解行为，未复制发布代码。

## MIT License

The MIT License

Copyright (c) Atai Barkai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
