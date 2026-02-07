Clean_Page_Tool:.
├── LICENSE # 许可证文件
├── prd.md # 产品需求文档
├── README.md # 使用与开发说明
├── extension
│   ├── background.js # 后台服务与扫描/估算逻辑
│   ├── contentScript.js # 页面摘要与指标采集
│   ├── manifest.json # 扩展清单与权限配置
│   ├── popup.css # 弹窗样式
│   ├── popup.html # 弹窗结构
│   ├── popup.js # 弹窗交互与渲染逻辑
│   ├── assets
│   │   └── cat-placeholder.png # 缩略图占位图（黑猫）
│   ├── icons
│   │   ├── icon128.png # 扩展图标 128px
│   │   ├── icon16.png # 扩展图标 16px
│   │   ├── icon32.png # 扩展图标 32px
│   │   └── icon48.png # 扩展图标 48px
│   └── install
│       └── one-click-install.cmd # 一键安装脚本（下载运行）
└── native-host
    ├── auto-install.ps1 # 自动检测扩展ID并安装
    ├── host.cmd # 启动 Native Host
    ├── host.js # Native Host 主程序
    ├── install.ps1 # 手动安装 Native Host
    └── uninstall.ps1 # 卸载 Native Host
