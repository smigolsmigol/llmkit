"""Fix all .mcp.json files across f3d1 projects - normalize all paths to forward slashes."""
import json
from pathlib import Path

ROOT = Path("C:/f3d1")
VENV_PYTHON = "C:/Users/cocco/.claude/mcp_venv/Scripts/python.exe"
MCP_SERVER = "C:/Users/cocco/.claude/mcp_server.py"
fixed = 0

for mcp_file in ROOT.rglob(".mcp.json"):
    try:
        data = json.loads(mcp_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        continue

    changed = False
    servers = data.get("mcpServers", {})

    for name, cfg in servers.items():
        cmd = cfg.get("command", "")
        args = cfg.get("args", [])

        # Fix WSL/Linux paths
        if "lotruser" in cmd or "/home/" in cmd:
            cfg["command"] = VENV_PYTHON
            changed = True

        # Fix bare "python" to venv python
        if cmd == "python":
            cfg["command"] = VENV_PYTHON
            changed = True

        # Normalize backslashes to forward slashes in command
        if "\\" in cmd:
            cfg["command"] = cmd.replace("\\", "/")
            changed = True

        # Normalize backslashes in all args
        for i, arg in enumerate(args):
            if isinstance(arg, str) and "\\" in arg:
                args[i] = arg.replace("\\", "/")
                changed = True
            if isinstance(arg, str) and ("lotruser" in arg or "/home/" in arg):
                if "mcp_server" in arg:
                    args[i] = MCP_SERVER
                    changed = True

    if changed:
        mcp_file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        fixed += 1
        rel = str(mcp_file).replace("C:\\f3d1\\", "").replace("C:/f3d1/", "")
        print(f"Fixed: {rel}")

print(f"\nTotal fixed: {fixed}")
