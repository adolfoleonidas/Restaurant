{
  "design_personality": {
    "brand_attributes": [
      "rápido",
      "confiable",
      "táctil (touch-first)",
      "hospitalidad profesional",
      "legible a distancia (cocina)",
      "calidez controlada (no juguetón)"
    ],
    "visual_style": {
      "base": "Warm-neutral SaaS (crema/arena) + teal operativo",
      "accent": "Terracota (alertas/acciones críticas) + ámbar (preparación)",
      "layout_principle": "Bento + Kanban (operación) con jerarquía fuerte y espacios amplios",
      "surface": "Tarjetas claras con bordes suaves, sombras cortas, sin gradientes pesados",
      "night_shift": "Modo cocina oscuro opcional con alto contraste y colores de estado más brillantes"
    }
  },

  "typography": {
    "google_fonts": {
      "heading": {
        "family": "Fraunces",
        "weights": [500, 700],
        "note": "Variable, con optical sizes e itálicas reales. Identidad de carta de restaurante (menú público, números de mesa, tickets)."
      },
      "body": {
        "family": "Inter",
        "weights": [400, 500, 600, 700],
        "note": "UI operativa y datos densos (caja, cocina, formularios). No usar Montserrat/Outfit para datos: demasiado anchas/geométricas."
      },
      "numbers": {
        "family": "IBM Plex Mono",
        "weights": [500, 600],
        "note": "Montos, timers y tickets: look de comprobante. Usar tabular-nums."
      }
    },
    "tailwind_defaults": {
      "apply": "font-sans",
      "recommended": "Configurar Tailwind fontFamily: { sans: ['Inter', ...], display: ['Fraunces', ...], mono: ['IBM Plex Mono', ...] }"
    },
    "scale": {
      "h1": "text-4xl sm:text-5xl lg:text-6xl font-display font-semibold tracking-tight",
      "h2": "text-base md:text-lg text-muted-foreground",
      "section_title": "text-lg md:text-xl font-display font-semibold",
      "card_title": "text-base font-semibold",
      "body": "text-sm md:text-base",
      "small": "text-xs md:text-sm",
      "kitchen_ticket_number": "text-2xl md:text-3xl font-display font-bold tracking-tight",
      "kitchen_timer": "text-sm md:text-base font-semibold tabular-nums"
    }
  },

  "color_system": {
    "notes": [
      "Evitar gradientes saturados/oscuros. Si se usa, solo como fondo decorativo en hero/login y <20% viewport.",
      "Estados (mesas/pedidos) deben ser inequívocos: color + etiqueta + icono.",
      "Texto siempre en charcoal (no negro puro) para reducir fatiga visual."
    ],
    "palette_hex": {
      "bg": "#F9F4EC",
      "bg_alt": "#F3ECE2",
      "surface": "#FFFDF7",
      "surface_warm": "#FBF6EE",
      "border": "#E4DACB",
      "text": "#2A2218",
      "text_muted": "#6F6255",
      "primary_amber": "#9E6D1A",
      "primary_amber_hover": "#855A14",
      "primary_amber_soft": "#F3E6D4",
      "accent_terracotta": "#B43822",
      "accent_terracotta_soft": "#F6D7CE",
      "focus_ring": "#9E6D1A",
      "shadow": "rgba(17, 24, 39, 0.08)"
    },
    "semantic_states": {
      "mesa_libre": {
        "label": "Libre",
        "bg": "#E7F6EE",
        "fg": "#0F5132",
        "border": "#BFE7D0",
        "dot": "#22C55E"
      },
      "mesa_ocupada": {
        "label": "Ocupada",
        "bg": "#FDE3E3",
        "fg": "#8C1D1D",
        "border": "#F5B5B5",
        "dot": "#EF4444"
      },
      "mesa_preparando": {
        "label": "Preparando",
        "bg": "#FFF6DB",
        "fg": "#6B4E00",
        "border": "#F3E2A6",
        "dot": "#F59E0B"
      },
      "mesa_listo": {
        "label": "Listo",
        "bg": "#E0EEFF",
        "fg": "#0B3A66",
        "border": "#A9CFF5",
        "dot": "#3B82F6"
      },
      "mesa_cuenta": {
        "label": "Cuenta solicitada",
        "bg": "#FFE0CC",
        "fg": "#8C3A12",
        "border": "#F5B488",
        "dot": "#E07A5F"
      },
      "mesa_entregado": {
        "label": "Entregado",
        "bg": "#EAF6F5",
        "fg": "#0F4F49",
        "border": "#BFE5E0",
        "dot": "#14B8A6"
      },
      "mesa_pagada": {
        "label": "Cuenta pagada",
        "bg": "#F2F2F2",
        "fg": "#3F3F46",
        "border": "#D4D4D8",
        "dot": "#71717A"
      },
      "mesa_reservada": {
        "label": "Reservada",
        "bg": "#F3F0FF",
        "fg": "#3B2A66",
        "border": "#D9D2F0",
        "dot": "#7C6BC4"
      },
      "mesa_inactiva": {
        "label": "Inactiva",
        "bg": "#EFEFEF",
        "fg": "#71717A",
        "border": "#D4D4D8",
        "dot": "#A1A1AA"
      }
    },
    "payment_methods": {
      "efectivo": { "chip_bg": "#F2F2F2", "chip_fg": "#1F1D1B" },
      "yape": { "chip_bg": "#EAF7F5", "chip_fg": "#0F4F49" },
      "plin": { "chip_bg": "#EAF2FF", "chip_fg": "#123A66" },
      "tarjeta": { "chip_bg": "#FFF1E8", "chip_fg": "#6B2F1F" },
      "transferencia": { "chip_bg": "#F3F0FF", "chip_fg": "#3B2A66" },
      "mixto": { "chip_bg": "#FFF6DB", "chip_fg": "#6B4E00" }
    },
    "dark_mode_kitchen": {
      "enabled_for": "Pantallas de cocina (tablet) y opcional para caja",
      "palette_hex": {
        "bg": "#0E1111",
        "surface": "#141A1A",
        "surface_2": "#0F1414",
        "border": "#243030",
        "text": "#F4F1EC",
        "text_muted": "#B7ADA3",
        "primary_teal": "#2AA79A",
        "accent_terracotta": "#E07A5F",
        "focus_ring": "#3BC7B8"
      },
      "state_boost": "En modo oscuro, subir saturación/brightness de dots y bordes para legibilidad a distancia."
    }
  },

  "design_tokens_css": {
    "instructions": "Reemplazar tokens en /app/frontend/src/index.css :root y .dark. Mantener HSL si el proyecto lo usa; aquí se proveen HEX + sugerencia de mapeo.",
    "css_variables": {
      "--radius": "12px",
      "--shadow-sm": "0 1px 2px rgba(17,24,39,.06)",
      "--shadow-md": "0 10px 24px rgba(17,24,39,.10)",
      "--tap-min": "44px",
      "--tap-kitchen": "64px",
      "--ring": "#2A8C80",
      "--bg": "#FBF6F0",
      "--surface": "#FFFFFF",
      "--surface-warm": "#FFF7EF",
      "--border": "#E7DED5",
      "--text": "#1F1D1B",
      "--text-muted": "#6F6258",
      "--primary": "#1F6F66",
      "--primary-hover": "#165A53",
      "--primary-soft": "#D7EFEC",
      "--accent": "#C65A3D",
      "--accent-soft": "#F6D7CE"
    }
  },

  "spacing_and_sizing": {
    "system": {
      "base_unit": "4px",
      "recommended_steps": [
        "4, 8, 12, 16, 20, 24, 32, 40, 48, 64"
      ],
      "container_padding": {
        "mobile": "px-4",
        "tablet": "px-6",
        "desktop": "px-8"
      }
    },
    "touch_targets": {
      "minimum": "min-h-[44px] min-w-[44px]",
      "standard": "h-12 (48px)",
      "kitchen": "h-16 (64px) y botones con text-base md:text-lg",
      "table_cards": "min-h-[96px] (mobile) / min-h-[120px] (tablet)"
    },
    "radii": {
      "cards": "rounded-xl",
      "buttons": "rounded-lg",
      "chips": "rounded-full",
      "kitchen_tickets": "rounded-2xl"
    }
  },

  "layout_patterns": {
    "app_shell": {
      "pattern": "Sidebar + Topbar (desktop) / Bottom nav o Sheet (mobile)",
      "topbar": {
        "left": "Nombre del restaurante + selector de local (si aplica)",
        "center_optional": "Indicador de sincronización: 'Actualizando…' (polling 3s)",
        "right": "Estado de caja (Abierta/Cerrada) + usuario + menú",
        "classes": "sticky top-0 z-40 bg-[var(--surface)]/90 backdrop-blur border-b"
      },
      "sidebar": {
        "desktop": "w-64 border-r bg-[var(--surface)]",
        "mobile": "Sheet (hamburger) + atajos principales",
        "role_based_nav": {
          "Admin": ["Dashboard", "Mesas", "Pedidos", "Cocina", "Caja", "Reportes", "Productos", "Categorías", "Usuarios", "Configuración"],
          "Cajero": ["Dashboard", "Caja", "Apertura", "Cierre", "Reportes"],
          "Mozo": ["Mesas", "Nuevo pedido", "Pedidos"],
          "Cocina": ["Cocina"]
        }
      },
      "grid": {
        "dashboard": "grid gap-4 md:gap-6 md:grid-cols-12",
        "kpi_cards": "col-span-12 md:col-span-3",
        "main_panels": "col-span-12 md:col-span-8",
        "side_panels": "col-span-12 md:col-span-4"
      }
    },
    "tables_screen": {
      "pattern": "Header con filtros + grid de mesas",
      "grid_classes": "grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
      "filters": "Tabs para zonas + Select para estado + búsqueda",
      "legend": "Fila de badges con colores de estado (siempre visible en mobile)"
    },
    "order_taking": {
      "pattern": "Split layout: categorías + productos + carrito",
      "mobile": "Tabs: Productos | Carrito (Drawer para carrito)",
      "tablet_desktop": "grid grid-cols-12 gap-4: categorías col-span-3, productos col-span-6, carrito col-span-3",
      "product_grid": "grid grid-cols-2 md:grid-cols-3 gap-3",
      "cart": "sticky top-[64px] max-h-[calc(100vh-96px)] overflow-auto"
    },
    "cashier": {
      "pattern": "Lista de pagos pendientes + panel de detalle",
      "mobile": "Lista -> detalle en Drawer",
      "desktop": "grid grid-cols-12 gap-4: lista col-span-5, detalle col-span-7"
    },
    "reports": {
      "pattern": "Filtros arriba + cards con charts",
      "chart_cards": "Card con header compacto + área de chart con padding generoso"
    }
  },

  "component_patterns": {
    "state_badges": {
      "use": ["/app/frontend/src/components/ui/badge.jsx"],
      "pattern": {
        "mesa": "Badge + dot + label",
        "order": "Badge + timer + prioridad"
      },
      "classes": {
        "base": "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
        "dot": "h-2.5 w-2.5 rounded-full",
        "available": "bg-[#E7F6EE] text-[#0F5132] border border-[#BFE7D0]",
        "occupied": "bg-[#FDECEC] text-[#7A1F1F] border border-[#F7C7C7]",
        "preparing": "bg-[#FFF6DB] text-[#6B4E00] border border-[#F3E2A6]",
        "ready": "bg-[#E6F2FF] text-[#0B3A66] border border-[#B9DAFF]",
        "cancelled": "bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8]"
      },
      "data_testid": {
        "badge": "mesa-estado-badge",
        "dot": "mesa-estado-dot"
      }
    },

    "mesa_card": {
      "use": ["/app/frontend/src/components/ui/card.jsx", "/app/frontend/src/components/ui/button.jsx", "/app/frontend/src/components/ui/badge.jsx"],
      "anatomy": [
        "Header: Mesa # + capacidad (icono Users)",
        "Body: estado badge + total actual (si ocupada) + tiempo",
        "Footer: CTA principal (Abrir/Ver pedido)"
      ],
      "classes": {
        "card": "rounded-xl border bg-white shadow-[var(--shadow-sm)] active:scale-[0.99]",
        "card_state_border": "border-l-8 (color por estado)",
        "title": "text-base font-semibold",
        "meta": "text-xs text-[var(--text-muted)]",
        "cta": "h-12 w-full"
      },
      "micro_interactions": [
        "Hover (desktop): elevar sombra sm->md y resaltar borde",
        "Active (touch): scale 0.99 + haptic (si disponible en PWA)",
        "Focus: ring-2 ring-[var(--ring)]"
      ],
      "data_testid": {
        "card": "mesa-card",
        "primary_action": "mesa-card-primary-action"
      }
    },

    "kitchen_order_card": {
      "use": ["/app/frontend/src/components/ui/card.jsx", "/app/frontend/src/components/ui/button.jsx", "/app/frontend/src/components/ui/badge.jsx", "/app/frontend/src/components/ui/separator.jsx"],
      "priority": "Diseñado para leerse a 2–3 metros",
      "anatomy": [
        "Top row: Pedido # + Mesa + canal (salón/para llevar) + timer grande",
        "Items: lista corta con cantidades grandes; modifiers en texto muted",
        "Notes: bloque destacado (alergias/observaciones)",
        "Actions: botones XL (Aceptar / En preparación / Listo / Revertir)"
      ],
      "classes": {
        "card": "rounded-2xl border bg-[var(--surface)] shadow-[var(--shadow-md)]",
        "header": "flex items-start justify-between gap-3",
        "ticket_number": "text-2xl md:text-3xl font-display font-bold",
        "timer": "px-3 py-1 rounded-full bg-black/5 text-[var(--text)] tabular-nums",
        "items": "space-y-2 text-base md:text-lg",
        "qty": "inline-flex min-w-10 justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] font-semibold px-2 py-1",
        "note": "rounded-xl border border-[#F3E2A6] bg-[#FFF6DB] p-3 text-sm md:text-base",
        "actions_row": "grid grid-cols-2 gap-3",
        "action_btn": "h-16 text-base md:text-lg rounded-xl"
      },
      "elapsed_time_indicator": {
        "rule": "Cambiar color del timer por umbrales: <8m neutral, 8–15m ámbar, >15m terracota",
        "classes": {
          "neutral": "bg-black/5",
          "warn": "bg-[#FFF6DB] text-[#6B4E00]",
          "late": "bg-[#F6D7CE] text-[#7A1F1F]"
        }
      },
      "data_testid": {
        "card": "cocina-ticket-card",
        "accept": "cocina-ticket-accept-button",
        "prep": "cocina-ticket-prep-button",
        "ready": "cocina-ticket-ready-button",
        "undo": "cocina-ticket-undo-button"
      }
    },

    "payment_modal": {
      "use": ["/app/frontend/src/components/ui/dialog.jsx", "/app/frontend/src/components/ui/tabs.jsx", "/app/frontend/src/components/ui/input.jsx", "/app/frontend/src/components/ui/button.jsx", "/app/frontend/src/components/ui/badge.jsx", "/app/frontend/src/components/ui/separator.jsx"],
      "anatomy": [
        "Header: Total a cobrar (S/) + resumen",
        "Tabs: Efectivo | Yape | Plin | Tarjeta | Transferencia | Mixto",
        "Body: inputs por método + calculadora de vuelto (efectivo)",
        "Footer: Cobrar (primary) + Cancelar (ghost)"
      ],
      "cash_change_calculator": {
        "pattern": "Input 'Recibido' -> muestra 'Vuelto' en grande",
        "classes": {
          "received": "h-12 text-base tabular-nums",
          "change": "text-2xl font-display font-semibold tabular-nums"
        }
      },
      "method_chips": {
        "pattern": "Badge tipo chip con icono + nombre",
        "classes": "rounded-full px-3 py-1"
      },
      "data_testid": {
        "open": "caja-cobrar-open-button",
        "dialog": "caja-cobrar-dialog",
        "submit": "caja-cobrar-submit-button",
        "received_input": "caja-cobrar-efectivo-recibido-input"
      }
    }
  },

  "kitchen_board_guidance": {
    "importance": "Pantalla crítica: debe ser ultra legible, táctil y sin distracciones.",
    "layout": {
      "columns": ["Nuevos", "En preparación", "Listos"],
      "classes": {
        "board": "h-[calc(100vh-64px)] overflow-hidden",
        "columns_wrap": "grid grid-cols-1 md:grid-cols-3 gap-4 h-full",
        "column": "rounded-2xl border bg-[var(--surface-warm)] p-3 md:p-4 flex flex-col",
        "column_header": "flex items-center justify-between pb-2",
        "column_title": "text-lg md:text-xl font-display font-semibold",
        "column_count": "text-sm text-[var(--text-muted)]"
      },
      "scrolling": "Cada columna tiene ScrollArea interno; evitar scroll del body.",
      "empty_column": "Mostrar estado vacío con icono y texto corto: 'Sin pedidos'."
    },
    "interaction_model": {
      "primary_actions": [
        "Nuevos: Aceptar",
        "En preparación: Marcar listo",
        "Listos: Entregado/Retirar"
      ],
      "secondary_actions": ["Ver detalle", "Imprimir", "Revertir"],
      "gesture": "Tap único para acción primaria; long-press abre menú secundario (ContextMenu) en tablet.",
      "feedback": [
        "Animación de 'bump' (Framer Motion): card slide + fade",
        "Toast Sonner: 'Pedido #123 → Listo'",
        "Sonido opcional (toggle) para nuevos pedidos"
      ]
    },
    "real_time": {
      "polling": "Cada 3s: mostrar indicador sutil en topbar: punto pulsante + 'Actualizando…'",
      "conflict": "Si un ticket cambia de estado por otro usuario, resaltar borde 2s (ring)"
    },
    "dark_mode_recommendation": "Activar por defecto en /cocina (toggle visible)."
  },

  "motion_and_microinteractions": {
    "library": {
      "recommended": "framer-motion",
      "install": "npm i framer-motion",
      "usage": "Usar motion.div para entrada de cards, y AnimatePresence para mover tickets entre columnas"
    },
    "principles": [
      "Duraciones cortas: 120–180ms para hover/press; 220–320ms para transiciones de panel",
      "Easing: ease-out para entrada; ease-in para salida",
      "No usar transition: all (solo color, background-color, box-shadow, border-color)"
    ],
    "patterns": {
      "button_press": "active:scale-[0.98]",
      "card_hover": "hover:shadow-[var(--shadow-md)] hover:-translate-y-[1px] (solo desktop)",
      "sync_indicator": "dot con animate-pulse + texto pequeño"
    }
  },

  "iconography": {
    "library": "lucide-react",
    "stroke": "2 (default)",
    "sizes": {
      "nav": "18-20",
      "buttons": "18",
      "kitchen": "22-24",
      "status_dot": "no icon; usar dot"
    },
    "recommended_icons": {
      "dashboard": "LayoutDashboard",
      "mesas": "Grid2X2",
      "pedidos": "Receipt",
      "cocina": "ChefHat",
      "caja": "Wallet",
      "reportes": "BarChart3",
      "productos": "Package",
      "categorias": "Tags",
      "usuarios": "Users",
      "configuracion": "Settings",
      "sync": "RefreshCw"
    }
  },

  "empty_and_loading_states": {
    "loading": {
      "use": ["/app/frontend/src/components/ui/skeleton.jsx", "/app/frontend/src/components/ui/progress.jsx"],
      "patterns": [
        "Mesas: skeleton grid 2x3 en mobile",
        "Cocina: skeleton tickets con altura fija",
        "Reportes: skeleton chart card + shimmer"
      ],
      "copy_es": {
        "generic": "Cargando…",
        "sync": "Actualizando…"
      }
    },
    "empty": {
      "use": ["/app/frontend/src/components/ui/card.jsx", "/app/frontend/src/components/ui/button.jsx"],
      "patterns": {
        "no_orders": {
          "title": "Sin pedidos",
          "desc": "Cuando entren nuevos pedidos aparecerán aquí.",
          "cta": "Refrescar"
        },
        "no_products": {
          "title": "Sin productos",
          "desc": "Crea tu primer producto para empezar a vender.",
          "cta": "Nuevo producto"
        },
        "no_tables": {
          "title": "Sin mesas configuradas",
          "desc": "Agrega mesas y zonas para operar el salón.",
          "cta": "Configurar mesas"
        }
      }
    },
    "error": {
      "use": ["/app/frontend/src/components/ui/alert.jsx"],
      "copy_es": {
        "network": "No se pudo actualizar. Reintentando…",
        "permission": "No tienes permisos para esta acción."
      },
      "data_testid": {
        "alert": "global-error-alert"
      }
    }
  },

  "images": {
    "usage_note": "App operacional: usar imágenes solo en login y productos. Evitar imágenes pesadas en pantallas críticas.",
    "image_urls": [
      {
        "category": "login_background_optional",
        "description": "Fondo sutil (blur + overlay crema) para /login; mantener legibilidad.",
        "url": "https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
      },
      {
        "category": "login_background_optional",
        "description": "Alternativa con identidad Perú (Cusco).",
        "url": "https://images.pexels.com/photos/30924602/pexels-photo-30924602.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
      },
      {
        "category": "product_placeholder",
        "description": "Imagen ejemplo para productos (ceviche). Usar como placeholder en catálogo.",
        "url": "https://images.pexels.com/photos/26586571/pexels-photo-26586571.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
      },
      {
        "category": "product_placeholder",
        "description": "Imagen alternativa para productos (ceviche).",
        "url": "https://images.pexels.com/photos/29188618/pexels-photo-29188618.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
      }
    ]
  },

  "component_path": {
    "shadcn_ui": [
      "/app/frontend/src/components/ui/button.jsx",
      "/app/frontend/src/components/ui/card.jsx",
      "/app/frontend/src/components/ui/badge.jsx",
      "/app/frontend/src/components/ui/dialog.jsx",
      "/app/frontend/src/components/ui/drawer.jsx",
      "/app/frontend/src/components/ui/sheet.jsx",
      "/app/frontend/src/components/ui/tabs.jsx",
      "/app/frontend/src/components/ui/table.jsx",
      "/app/frontend/src/components/ui/select.jsx",
      "/app/frontend/src/components/ui/input.jsx",
      "/app/frontend/src/components/ui/textarea.jsx",
      "/app/frontend/src/components/ui/scroll-area.jsx",
      "/app/frontend/src/components/ui/separator.jsx",
      "/app/frontend/src/components/ui/skeleton.jsx",
      "/app/frontend/src/components/ui/sonner.jsx",
      "/app/frontend/src/components/ui/alert.jsx",
      "/app/frontend/src/components/ui/calendar.jsx"
    ],
    "charts": ["recharts"],
    "motion": ["framer-motion (recommended)"]
  },

  "instructions_to_main_agent": [
    "Eliminar estilos default de CRA en App.css (App-header centrado). No centrar contenedor global.",
    "Actualizar tokens en index.css para reflejar la paleta warm-neutral + teal. Mantener contraste AA.",
    "Implementar AppShell con Sidebar/Topbar y navegación por rol. En mobile usar Sheet/Drawer.",
    "Mesas: grid de cards con borde izquierdo por estado + badge + CTA grande. Leyenda de estados siempre visible.",
    "Cocina: Kanban 3 columnas con ScrollArea interno; cards XL con timer y acciones grandes (64px). Activar dark mode por defecto en /cocina.",
    "Caja: modal de cobro con Tabs por método (Efectivo/Yape/Plin/Tarjeta/Transferencia/Mixto) + calculadora de vuelto.",
    "Reportes: Recharts dentro de Cards; usar colores chart derivados de teal/terracotta/amber/blue con fondos sólidos.",
    "Añadir data-testid (kebab-case) a TODO elemento interactivo y a info crítica (totales, estados, errores).",
    "Indicador de polling 3s: RefreshCw + punto pulsante + texto 'Actualizando…' (no intrusivo).",
    "No usar transition: all. Solo transicionar color/background-color/box-shadow/border-color."
  ],

  "general_ui_ux_design_guidelines": "<General UI UX Design Guidelines>  \n    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms\n    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text\n   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json\n\n **GRADIENT RESTRICTION RULE**\nNEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc\nNEVER use dark gradients for logo, testimonial, footer etc\nNEVER let gradients cover more than 20% of the viewport.\nNEVER apply gradients to text-heavy content or reading areas.\nNEVER use gradients on small UI elements (<100px width).\nNEVER stack multiple gradient layers in the same viewport.\n\n**ENFORCEMENT RULE:**\n    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors\n\n**How and where to use:**\n   • Section backgrounds (not content backgrounds)\n   • Hero section header content. Eg: dark to light to dark color\n   • Decorative overlays and accent elements only\n   • Hero section with 2-3 mild color\n   • Gradients creation can be done for any angle say horizontal, vertical or diagonal\n\n- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**\n\n</Font Guidelines>\n\n- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. \n   \n- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.\n\n- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.\n   \n- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly\n    Eg: - if it implies playful/energetic, choose a colorful scheme\n           - if it implies monochrome/minimal, choose a black–white/neutral scheme\n\n**Component Reuse:**\n\t- Prioritize using pre-existing components from src/components/ui when applicable\n\t- Create new components that match the style and conventions of existing components when needed\n\t- Examine existing components to understand the project's component patterns before creating new ones\n\n**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component\n\n**Best Practices:**\n\t- Use Shadcn/UI as the primary component library for consistency and accessibility\n\t- Import path: ./components/[component-name]\n\n**Export Conventions:**\n\t- Components MUST use named exports (export const ComponentName = ...)\n\t- Pages MUST use default exports (export default function PageName() {...})\n\n**Toasts:**\n  - Use `sonner` for toasts\"\n  - Sonner component are located in `/app/src/components/ui/sonner.tsx`\n\nUse 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.\n</General UI UX Design Guidelines>"
}
