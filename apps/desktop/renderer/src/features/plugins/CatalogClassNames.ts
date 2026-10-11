/*
 * 扩展目录（插件 / 技能）共享的 Tailwind class 片段。
 *
 * 这些片段在多个卡片、详情页与弹窗之间重复出现：
 * - `forced-colors` 系统色（Canvas / CanvasText / Highlight）无法用设计令牌表达，
 *   随组件一起声明，替代原 marketplace.scss 的 forced-colors 块。
 * - 纯按钮外壳、两行式说明文本与单行截断文本在卡片间共用。
 */

/** forced-colors 下把表面压平为 Canvas / CanvasText。 */
export const FORCED_COLORS_SURFACE_CLASS =
  'tw:forced-colors:border-[color:CanvasText] tw:forced-colors:bg-[color:Canvas] tw:forced-colors:[color:CanvasText] tw:forced-colors:shadow-none'

/** forced-colors 下的焦点环改用系统高亮色。 */
export const FORCED_COLORS_FOCUS_CLASS =
  'tw:forced-colors:focus-visible:outline-2 tw:forced-colors:focus-visible:outline-offset-2 tw:forced-colors:focus-visible:outline-[color:Highlight]'

/** 无外观的整块按钮：重置按钮默认值，只保留排版与焦点环。 */
export const PLAIN_BUTTON_CLASS =
  'tw:grid tw:min-w-0 tw:cursor-pointer tw:items-center tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus'

/** 卡片正文列：标签 + 说明的两行网格。 */
export const STACKED_COPY_CLASS = 'tw:grid tw:min-w-0 tw:gap-1'

/** 单行溢出省略的次要文本。 */
export const TRUNCATED_LINE_CLASS =
  'tw:min-w-0 tw:overflow-hidden tw:text-app-text-meta tw:type-body-sm tw:text-ellipsis tw:whitespace-nowrap'

/** 详情页/详情弹窗里的元数据行（dt 标签 + dd 值）。 */
export const DETAILS_METADATA_CLASS = 'tw:grid tw:m-0 tw:gap-0'

/** 单条元数据行：固定标签列 + 自适应值列。 */
export const DETAILS_METADATA_ROW_CLASS =
  'tw:grid tw:grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)] tw:gap-4 tw:border-b tw:border-b-app-border-subtle tw:py-3'

/** 元数据标签列。 */
export const DETAILS_METADATA_LABEL_CLASS =
  'tw:m-0 tw:min-w-0 tw:text-app-text-meta tw:type-caption tw:wrap-anywhere'

/** 元数据取值列。 */
export const DETAILS_METADATA_VALUE_CLASS =
  'tw:m-0 tw:min-w-0 tw:text-app-text tw:type-body-sm tw:wrap-anywhere'

/** 详情页小节：标题 + 内容的网格。 */
export const DETAILS_SECTION_CLASS = 'tw:grid tw:min-w-0 tw:gap-4'

/** 详情页小节标题（含上边距与分隔线）。 */
export const DETAILS_SECTION_HEADING_CLASS =
  'tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-t tw:border-t-app-border-subtle tw:pt-5'

/** 详情页小节标题文字。 */
export const DETAILS_SECTION_TITLE_CLASS = 'tw:m-0 tw:text-app-text tw:type-title-sm'

/** 详情页身份块（图标 + 标题 + 描述）。 */
export const DETAILS_IDENTITY_CLASS = 'tw:grid tw:min-w-0 tw:gap-1'

/** 详情页图标槽位。 */
export const DETAILS_ICON_CLASS =
  'tw:inline-flex tw:size-11 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text'

/** 详情页动作组（右对齐、可换行，窄容器左对齐）。 */
export const DETAILS_ACTION_GROUP_CLASS =
  'tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:@max-[479px]/plugins-page:justify-start'

/** 详情页面包屑（工作区头部插槽）。 */
export const DETAILS_BREADCRUMB_CLASS =
  'tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption'

/** 面包屑里的当前项：单行截断。 */
export const DETAILS_BREADCRUMB_CURRENT_CLASS =
  'tw:overflow-hidden tw:text-app-text tw:text-ellipsis tw:whitespace-nowrap'

/** 错误提示块（详情页与详情弹窗共用）。 */
export const DETAILS_ERROR_CLASS =
  'tw:mt-4 tw:mb-0 tw:rounded-lg tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:p-3 tw:text-app-danger-fg tw:type-body-sm'
