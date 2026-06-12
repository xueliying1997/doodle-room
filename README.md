# 多人白板涂鸦

这是一个多人“你画我猜”白板游戏 MVP。

## 运行方式

在这个文件夹里打开终端，然后运行：

```bash
node doodle-server.mjs
```

看到下面这行后，不要关闭终端：

```text
Doodle Room is running at http://localhost:4173
```

然后打开：

```text
http://127.0.0.1:4173/
```

## 当前功能

- 房间码
- 房间二维码和邀请链接，玩家扫码后直接加入当前房间
- 每轮只有一个画手
- 词语只显示给当前画手
- 其他玩家只能观看画布并提交猜测
- 每个猜词玩家每轮最多 3 次猜错机会，第 3 次猜错会自动进入下一轮
- 只有猜中者获得积分，画手不加分
- 有人猜对时会立刻加分并自动进入下一轮
- 实时画布和猜词列表
- 倒计时
- 颜色和笔刷大小
- 撤销、清空、导出 PNG、下一轮

## 部署到 Render

这个项目需要 Node 后端实时服务，适合部署为 Render Web Service，不适合只上传到 GitHub Pages 这类静态网站。

推荐设置：

```text
Root Directory: 多人白板涂鸦
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
```

如果使用 `render.yaml`，Render 会读取里面的服务配置。

部署成功后，Render 会给你一个类似下面的网址：

```text
https://doodle-room-mvp.onrender.com
```

玩家打开这个网址，输入同一个房间码，就能加入同一个白板房间。
