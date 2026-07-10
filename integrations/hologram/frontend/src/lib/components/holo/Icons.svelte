<script>
  /**
   * Hologram v6.1 Icon System
   * Replace emojis with clean, minimal line icons
   */
  import {
    Search, Globe, Palette, Box, Settings, Wallet, FileText, FolderOpen, Upload,
    RefreshCw, Package, Copy, ArrowUp, ArrowDown, ArrowLeftRight, ArrowRight, Lock, Unlock,
    Eye, EyeOff, ChevronDown, ChevronRight, X, Check, AlertTriangle, Info,
    Clock, Zap, Database, Server, Link, ExternalLink, Cpu, Activity, Hash,
    Code, FileCode, Layers, Grid3X3, PanelLeft, History, Trash2, Plus, Minus,
    Send, Download, RotateCw, Home, Bookmark, Star, Filter, MoreHorizontal,
    Terminal, Shield, Key, Users, Target, Crosshair, Sparkles, Gauge, Blocks,
    CircleDot, Hexagon, Triangle, Square, Diamond, Circle, Wrench, Puzzle,
    Play, Pause, StopCircle, PickaxeIcon, TrendingUp, Heart, Globe2, Gamepad2,
    Github, BookOpen
  } from 'lucide-svelte';

  export let name = 'circle';
  export let size = 16;
  export let strokeWidth = 1.5;
  export let className = '';

  // Icon mapping - emoji → lucide component name
  const iconMap = {
    // Navigation
    'search': Search,
    'browser': Globe,
    'studio': Palette,
    'mods': Puzzle,
    'explorer': Blocks,
    'wallet': Wallet,
    'settings': Settings,
    
    // Actions
    'upload': Upload,
    'download': Download,
    'refresh': RefreshCw,
    'copy': Copy,
    'send': ArrowUp,
    'receive': ArrowDown,
    'swap': ArrowLeftRight,
    'close': X,
    'x': X,  // Alias for close
    'check': Check,
    'add': Plus,
    'remove': Minus,
    'delete': Trash2,
    'external': ExternalLink,
    'home': Home,
    'bookmark': Bookmark,
    'star': Star,
    'filter': Filter,
    'more': MoreHorizontal,
    
    // Files & Folders
    'folder': FolderOpen,
    'file': FileText,
    'file-code': FileCode,
    'code': Code,
    'package': Package,
    'layers': Layers,
    
    // Status
    'lock': Lock,
    'unlock': Unlock,
    'eye': Eye,
    'eye-off': EyeOff,
    'warning': AlertTriangle,
    'info': Info,
    'shield': Shield,
    'key': Key,
    
    // Data
    'database': Database,
    'server': Server,
    'cpu': Cpu,
    'activity': Activity,
    'hash': Hash,
    'link': Link,
    'blocks': Blocks,
    'grid': Grid3X3,
    'gauge': Gauge,
    
    // UI
    'chevron-down': ChevronDown,
    'chevron-right': ChevronRight,
    'panel': PanelLeft,
    'history': History,
    'clock': Clock,
    'terminal': Terminal,
    'target': Target,
    'crosshair': Crosshair,
    'sparkles': Sparkles,
    'zap': Zap,
    'wrench': Wrench,
    
    // Users
    'users': Users,
    'user': Users,
    
    // Shapes (for v6.1 minimal style)
    'circle': Circle,
    'square': Square,
    'diamond': Diamond,
    'triangle': Triangle,
    'hexagon': Hexagon,
    'dot': CircleDot,
    
    // Media controls
    'play': Play,
    'pause': Pause,
    'stop': StopCircle,
    
    // Mining
    'pickaxe': PickaxeIcon,
    
    // Analytics & Navigation
    'trending': TrendingUp,
    'arrow-right': ArrowRight,
    
    // Social & Content
    'heart': Heart,
    'globe': Globe,
    'github': Github,
    'book': BookOpen,
    
    // Gaming / Simulator
    'gamepad': Gamepad2,
  };

  $: IconComponent = iconMap[name] || Circle;
</script>

<svelte:component 
  this={IconComponent} 
  size={size}
  strokeWidth={strokeWidth}
  class="holo-icon {className}"
/>
