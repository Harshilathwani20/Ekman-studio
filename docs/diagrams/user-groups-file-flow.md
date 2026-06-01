# User groups → file flow

Diagram showing how different user groups (Visitor, Customer, Admin, Developer) interact with the app and which files/modules are involved.

```mermaid
flowchart TB
  %% Users
  subgraph Users
    Visitor[Visitor]
    Customer[Customer]
    AdminUser[Admin]
    DeveloperUser[Developer]
  end

  %% Landing
  Index["index.html (landing page)"]

  Visitor --> Index
  Index -->|submit password| Security["engine/security.js\n(verify & redirect)"]
  Security -->|reads| Registry["clients/registry.json\n(slug → config path)"]
  Registry -->|loads| ClientCfg["clients/{slug}/client.json\n(adminPassword + passwords[])"]
  Security -->|plain / sha256 check| ClientCfg
  ClientCfg -->|match → redirect| TourDir["clients/{slug}/tours/{tour}/ (tour index)"]
  TourDir -->|viewer loads| Viewer["engine/viewer.js\n(renderer)"]
  Viewer --> TourJson["clients/{slug}/tours/{tour}/tour.json"]
  TourJson --> Assets["assets/* (panos, logos, css)"]
  Security --> Utils["engine/utils.js\n(sha256Hex, fetchJson, redirect)"]

  %% Admin flow
  AdminUser -->|open /?admin| AdminJS["engine/admin.js\n(admin auth & panel)"]
  AdminJS -->|verify sha256/plain| ClientCfg
  AdminJS --> Utils
  AdminJS -->|on success| AdminPanel["Admin panel UI\n(local edits)"]
  AdminPanel --> LS["localStorage\n(ekadmin_session, ekadmin_limits_)"]

  %% Dev flow
  DeveloperUser -->|?dev=cam or dev overlay| DevJS["engine/developer.js\n(dev helpers)"]
  DevJS --> Viewer
  DevJS --> LS

  %% Styling / classes
  classDef engineNode fill:#f3f9ff,stroke:#0366d6,stroke-width:1px;
  classDef clientNode fill:#fff8e1,stroke:#f39c12,stroke-width:1px;
  classDef assetNode fill:#eef7ee,stroke:#28a745,stroke-width:1px;
  class Security,AdminJS,DevJS,Viewer,Utils engineNode;
  class ClientCfg,Registry,TourJson clientNode;
  class Assets,LS assetNode;
```

> Notes:
- `engine/security.js` performs the landing password lookup and redirects to `clients/<slug>/tours/<tour>/` on success.
- Admin auth uses `engine/admin.js` and the `adminPassword` field in `clients/<slug>/client.json`.
- Developer helpers live in `engine/developer.js` and persist tweaks to `localStorage`.

---

File: `docs/diagrams/user-groups-file-flow.md` — open it to view or edit the diagram.