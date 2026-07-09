# DERO Hive Feature List

## 1. Project Folders

### Core Functionality
- Add/remove project folders via settings or sidebar
- Each project has: `id`, `name`, `icon`, `color`, `path`, `createdAt`
- Projects displayed in left sidebar as collapsible sections
- Conversations can be linked to a project or unlinked (default)
- Open project folder in file explorer

### Customization
- **Name**: Editable project name (default: folder name)
- **Icon**: Choose from emoji picker or icon library (default: folder emoji)
- **Color**: Accent color for project (default: auto from folder)
- **Path**: Filesystem path to project root

### Project Dashboard (click project header)
- Project stats: conversation count, last active, total messages
- Quick actions: new chat, open folder, project settings
- List all conversations under this project

---

## 2. Voice to Text (Working Mic)

### Speech Recognition Engine
- **Option A**: Vosk (offline, lightweight ~50MB model)
- **Option B**: Whisper.cpp (offline, accurate, ~100MB model)
- **Option C**: WebSocket to local STT server (fast, accurate)

### Recording Behavior
- Mic button starts recording when clicked
- Visual feedback: pulsing red icon + "Listening..." text
- Real-time transcription displayed in input bar
- Auto-stop after 30s of silence (configurable)

### Audio Notifications (toggleable in Settings)
- **Start recording**: Short "beep" or click sound
- **Stop recording**: Short "beep" or click sound
- Settings toggle: "Recording sounds" on/off
- Volume slider for notification sounds

### Microphone Selection
- List all available audio input devices
- Remember last used device
- Show device name in mic tooltip when selected

---

## 3. Fork Chats / Messages

### Fork Entire Chat
- Right-click conversation → "Fork chat"
- Creates new conversation with same messages
- Useful for branching conversations

### Fork from Message
- Hover any message → "Fork from here" button appears
- Creates new conversation starting from that message
- Previous context shown as "Parent: [original chat title]"

### Fork UI
- Fork icon in message hover actions
- Forked conversations show lineage indicator
- "View parent" link to original

---

## 4. Right Sidebar (Git / Files / Context)

### Layout
- Collapsible right sidebar (toggle button in toolbar)
- Tabs: **Git** | **Files** | **Context**

### Git Tab
- Current branch name (bold)
- Commit history (last 10 commits)
  - Hash, message, author, time
- Staged/unstaged changes summary
- Push/pull buttons (if remote exists)
- Diff viewer for changed files

### Files Tab
- Tree view of project files (if project linked)
- File icons based on extension
- Click to preview file
- Right-click: open in editor, copy path, etc.

### Context Tab
- Auto-generated summary of relevant context
- Project structure overview
- Recent files modified
- Active conversations in project
- Key files detected from conversation

---

## 5. Code Tab (IDE-like Editor + Terminal)

### Code Editor Panel
- Monaco Editor (VS Code editor component)
- File tabs for open files
- Syntax highlighting for all major languages
- Line numbers, minimap
- Search & replace

### Terminal Panel
- Embedded terminal (xterm.js)
- Multiple terminal tabs
- Split horizontal/vertical
- Clear, kill process buttons
- Command history

### Layout Options
- Side-by-side (editor left, terminal right)
- Stacked (editor top, terminal bottom)
- Tabbed (Code tab / Terminal tab)
- Resizable panels with drag handle

### Editor Features
- Save file (Ctrl+S)
- Open file in project
- Create new file
- Unsaved changes indicator
- Format document

### Terminal Features
- Run selected code (for interpreted languages)
- Git commands auto-detected
- Clear terminal button
- Copy terminal output

---

## Settings Pages (New)

### Voice Settings (new section)
- [ ] Microphone device dropdown
- [ ] Speech recognition engine ( Vosk / Whisper / Remote )
- [ ] Noise notification sounds toggle
- [ ] Notification volume slider
- [ ] Auto-stop silence timeout (5s / 10s / 30s / 60s / never)

### Project Settings (new section)
- [ ] List of configured projects
- [ ] Add project (browse folder)
- [ ] Edit project (name, icon, color)
- [ ] Remove project (unlink, not delete files)

### Editor Settings (new section)
- [ ] Font size
- [ ] Tab size
- [ ] Word wrap toggle
- [ ] Minimap toggle

---

## Database Schema Changes

### New `projects` table
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📁',
  color TEXT,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Modify `conversations` table
```sql
ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id);
```

### Modify `settings`
- Add `voiceNotificationSounds` (boolean)
- Add `voiceNotificationVolume` (number)
- Add `voiceSilenceTimeout` (number)
- Add `voiceEngine` ('vosk' | 'whisper' | 'remote')
- Add `voiceDeviceId` (string)

---

## Component Inventory

### New Components
- `ProjectSidebar.tsx` - Left sidebar project sections
- `ProjectSettingsModal.tsx` - Edit project name/icon/color
- `VoiceInput.tsx` - Working voice input (redesign)
- `AudioNotification.tsx` - Sound player
- `ForkMenu.tsx` - Fork from message menu
- `RightSidebar.tsx` - Container for git/files/context
- `GitPanel.tsx` - Git tab content
- `FilesPanel.tsx` - File tree content
- `ContextPanel.tsx` - Context tab content
- `CodeTab.tsx` - Editor + terminal container
- `MonacoEditor.tsx` - Editor wrapper
- `TerminalPanel.tsx` - Terminal component

### Modified Components
- `Sidebar.tsx` - Add project section
- `ConversationList.tsx` - Group by project
- `Message.tsx` - Add fork button
- `ComposerToolbar.tsx` - Add recording indicator
- `SettingsModal.tsx` - Add new settings tabs
- `GeneralPanel.tsx` - Add voice settings section
