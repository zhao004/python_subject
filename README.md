# 单词配对测验

这是从 `old/index.html` 重构后的 FastAPI + React + MySQL 版本，支持计时、成绩提交和全局排行榜。

## 环境准备

安装 Python 依赖：

```bash
pip install -r requirements.txt
```

复制 `.env.example` 为 `.env`，并填写 MySQL 连接信息：

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=quiz_db
MYSQL_CHARSET=utf8mb4
MYSQL_COLLATION=utf8mb4_unicode_ci
```

应用启动时会先检测目标数据库是否存在，不存在则自动创建；随后自动创建缺失的数据表，并同步模型中新增或变更的字段、索引和唯一约束。数据库中模型未声明的历史字段会保留，不会自动删除。

## 后端运行

```bash
uvicorn main:app --reload
```

MySQL 账号需要具备创建数据库和修改表结构的权限，否则启动会失败并输出对应数据库错误。

## 前端运行

```bash
cd frontend
npm install
npm run dev
```

开发服务器默认通过 Vite 代理访问 `http://127.0.0.1:8000/api`。

## 构建并由 FastAPI 托管

```bash
cd frontend
npm run build
cd ..
uvicorn main:app --reload
```

构建产物会输出到 `static/`，FastAPI 会在根路径返回 React 页面。

## 验证

```bash
pytest
```

测试会通过 `create_app(database_url=...)` 使用临时 SQLite 数据库，不依赖本地 MySQL 服务。
