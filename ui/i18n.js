// Panel strings in the ten supported languages. Game terms come from PoB itself.
export const LOCALES = {
  en: 'English', ko: '한국어', ja: '日本語', 'zh-Hant': '繁體中文', ru: 'Русский',
  de: 'Deutsch', fr: 'Français', es: 'Español', 'pt-BR': 'Português (Brasil)', th: 'ไทย',
};

const STRINGS = {
  en: {
    connected: 'PoB connected', disconnected: 'PoB not open', openPob: 'Open PoB', newChat: 'New chat', history: 'History',
    placeholder: 'Ask about your build…', send: 'Send', stop: 'Stop', thinking: 'Working…', noAgent: 'No AI agent found. Install Claude Code or Codex and sign in.',
    level: 'Level', mainSkill: 'Main skill', dps: 'DPS', life: 'Life', es: 'Energy Shield', ehp: 'Effective HP', noBuild: 'No build loaded',
    steps: 'steps', theme: 'Theme', language: 'Language', agent: 'Agent', emptyTitle: 'What should we do with your build?',
    s1: 'Set up PoB to measure my damage properly', s2: 'Which passive gives me the most damage?', s3: 'Where do I change the enemy settings?', s4: 'Import this build code',
    deleteChat: 'Delete', copied: 'Copied', error: 'Something went wrong',
    windowLanguage: 'PoB window language', windowTheme: 'PoB window theme', pobDefault: 'PoB default', updateAvailable: 'PoB AI {version} is available', updateNow: 'Update', updating: 'Updating…',
    pobFolder: 'PoB folder', apply: 'Use', installPob: 'Install PoB', installingPob: 'Installing PoB…', opening: 'Opening PoB…', pobNotFound: 'Path of Building (PoE2) was not found. Enter its folder in Settings, or install PoB from there.',
    pobFolderInvalid: 'No PoB (PoE2) in that folder. Pick the folder that contains "Path of Building-PoE2.exe".',
  },
  ko: {
    connected: 'PoB 연결됨', disconnected: 'PoB 꺼짐', openPob: 'PoB 열기', newChat: '새 대화', history: '대화 기록',
    placeholder: '빌드에 대해 물어보세요…', send: '보내기', stop: '중지', thinking: '작업 중…', noAgent: 'AI 에이전트를 찾지 못했습니다. Claude Code나 Codex를 설치하고 로그인하세요.',
    level: '레벨', mainSkill: '주력 스킬', dps: 'DPS', life: '생명력', es: '에너지 보호막', ehp: '유효 생명력', noBuild: '열린 빌드가 없습니다',
    steps: '단계', theme: '테마', language: '언어', agent: '에이전트', emptyTitle: '빌드에서 무엇을 해 볼까요?',
    s1: '내 캐릭터 기준으로 피해를 제대로 측정하도록 PoB를 세팅해 줘', s2: '어떤 패시브가 피해를 가장 많이 올려 줘?', s3: '적 설정은 어디서 바꿔?', s4: '이 빌드 코드 가져와 줘',
    deleteChat: '삭제', copied: '복사됨', error: '문제가 발생했습니다',
    windowLanguage: 'PoB 창 언어', windowTheme: 'PoB 창 테마', pobDefault: 'PoB 기본', updateAvailable: 'PoB AI {version} 업데이트가 있습니다', updateNow: '업데이트', updating: '업데이트 중…',
    pobFolder: 'PoB 폴더', apply: '적용', installPob: 'PoB 설치', installingPob: 'PoB 설치 중…', opening: 'PoB 여는 중…', pobNotFound: 'Path of Building (PoE2)를 찾지 못했습니다. 설정에서 PoB 폴더를 지정하거나 PoB를 설치하세요.',
    pobFolderInvalid: '그 폴더에서 PoB(PoE2)를 찾지 못했습니다. "Path of Building-PoE2.exe"가 있는 폴더를 지정하세요.',
  },
  ja: {
    connected: 'PoB 接続中', disconnected: 'PoB 未起動', openPob: 'PoB を開く', newChat: '新しいチャット', history: '履歴',
    placeholder: 'ビルドについて質問…', send: '送信', stop: '停止', thinking: '作業中…', noAgent: 'AI エージェントが見つかりません。Claude Code か Codex をインストールしてサインインしてください。',
    level: 'レベル', mainSkill: 'メインスキル', dps: 'DPS', life: 'ライフ', es: 'エナジーシールド', ehp: '有効ライフ', noBuild: 'ビルドが開かれていません',
    steps: 'ステップ', theme: 'テーマ', language: '言語', agent: 'エージェント', emptyTitle: 'ビルドで何をしますか？',
    s1: '自分のキャラ基準でダメージを正しく測れるよう PoB を設定して', s2: '一番ダメージが伸びるパッシブは？', s3: '敵の設定はどこで変える？', s4: 'このビルドコードを読み込んで',
    deleteChat: '削除', copied: 'コピーしました', error: 'エラーが発生しました',
    windowLanguage: 'PoB ウィンドウの言語', windowTheme: 'PoB ウィンドウのテーマ', pobDefault: 'PoB 標準', updateAvailable: 'PoB AI {version} が利用できます', updateNow: 'アップデート', updating: 'アップデート中…',
    pobFolder: 'PoB フォルダー', apply: '適用', installPob: 'PoB をインストール', installingPob: 'PoB をインストール中…', opening: 'PoB を起動中…', pobNotFound: 'Path of Building (PoE2) が見つかりません。設定で PoB のフォルダーを指定するか、PoB をインストールしてください。',
    pobFolderInvalid: 'そのフォルダーに PoB (PoE2) がありません。「Path of Building-PoE2.exe」があるフォルダーを指定してください。',
  },
  'zh-Hant': {
    connected: 'PoB 已連線', disconnected: 'PoB 未開啟', openPob: '開啟 PoB', newChat: '新對話', history: '紀錄',
    placeholder: '詢問你的流派…', send: '傳送', stop: '停止', thinking: '處理中…', noAgent: '找不到 AI 代理。請安裝並登入 Claude Code 或 Codex。',
    level: '等級', mainSkill: '主要技能', dps: 'DPS', life: '生命', es: '能量護盾', ehp: '有效生命', noBuild: '尚未開啟流派',
    steps: '步驟', theme: '主題', language: '語言', agent: '代理', emptyTitle: '要對流派做什麼？',
    s1: '依我的角色設定 PoB，正確計算傷害', s2: '哪個天賦最能提升傷害？', s3: '敵人設定在哪裡修改？', s4: '匯入這個流派代碼',
    deleteChat: '刪除', copied: '已複製', error: '發生錯誤',
    windowLanguage: 'PoB 視窗語言', windowTheme: 'PoB 視窗主題', pobDefault: 'PoB 預設', updateAvailable: '有新版 PoB AI {version}', updateNow: '更新', updating: '更新中…',
    pobFolder: 'PoB 資料夾', apply: '套用', installPob: '安裝 PoB', installingPob: '正在安裝 PoB…', opening: '正在開啟 PoB…', pobNotFound: '找不到 Path of Building (PoE2)。請在設定中指定 PoB 資料夾，或從那裡安裝 PoB。',
    pobFolderInvalid: '該資料夾中找不到 PoB (PoE2)。請指定含有「Path of Building-PoE2.exe」的資料夾。',
  },
  ru: {
    connected: 'PoB подключён', disconnected: 'PoB не запущен', openPob: 'Открыть PoB', newChat: 'Новый чат', history: 'История',
    placeholder: 'Спросите о билде…', send: 'Отправить', stop: 'Стоп', thinking: 'Работаю…', noAgent: 'ИИ-агент не найден. Установите Claude Code или Codex и войдите.',
    level: 'Уровень', mainSkill: 'Основное умение', dps: 'DPS', life: 'Здоровье', es: 'Энергетический щит', ehp: 'Эффективное здоровье', noBuild: 'Билд не открыт',
    steps: 'шагов', theme: 'Тема', language: 'Язык', agent: 'Агент', emptyTitle: 'Что сделать с билдом?',
    s1: 'Настрой PoB, чтобы правильно считать урон моего персонажа', s2: 'Какое пассивное умение даст больше урона?', s3: 'Где изменить настройки врага?', s4: 'Импортируй этот код билда',
    deleteChat: 'Удалить', copied: 'Скопировано', error: 'Произошла ошибка',
    windowLanguage: 'Язык окна PoB', windowTheme: 'Тема окна PoB', pobDefault: 'Стандартная PoB', updateAvailable: 'Доступна PoB AI {version}', updateNow: 'Обновить', updating: 'Обновление…',
    pobFolder: 'Папка PoB', apply: 'Применить', installPob: 'Установить PoB', installingPob: 'Установка PoB…', opening: 'Открываю PoB…', pobNotFound: 'Path of Building (PoE2) не найден. Укажите его папку в настройках или установите PoB оттуда.',
    pobFolderInvalid: 'В этой папке нет PoB (PoE2). Укажите папку, в которой лежит «Path of Building-PoE2.exe».',
  },
  de: {
    connected: 'PoB verbunden', disconnected: 'PoB nicht geöffnet', openPob: 'PoB öffnen', newChat: 'Neuer Chat', history: 'Verlauf',
    placeholder: 'Frag etwas zu deinem Build…', send: 'Senden', stop: 'Stopp', thinking: 'Arbeite…', noAgent: 'Kein KI-Agent gefunden. Installiere Claude Code oder Codex und melde dich an.',
    level: 'Stufe', mainSkill: 'Hauptfertigkeit', dps: 'DPS', life: 'Leben', es: 'Energieschild', ehp: 'Effektives Leben', noBuild: 'Kein Build geöffnet',
    steps: 'Schritte', theme: 'Design', language: 'Sprache', agent: 'Agent', emptyTitle: 'Was machen wir mit deinem Build?',
    s1: 'Richte PoB so ein, dass mein Schaden korrekt berechnet wird', s2: 'Welche Passive bringt am meisten Schaden?', s3: 'Wo ändere ich die Gegner-Einstellungen?', s4: 'Importiere diesen Build-Code',
    deleteChat: 'Löschen', copied: 'Kopiert', error: 'Etwas ist schiefgelaufen',
    windowLanguage: 'Sprache des PoB-Fensters', windowTheme: 'Design des PoB-Fensters', pobDefault: 'PoB-Standard', updateAvailable: 'PoB AI {version} ist verfügbar', updateNow: 'Aktualisieren', updating: 'Wird aktualisiert…',
    pobFolder: 'PoB-Ordner', apply: 'Übernehmen', installPob: 'PoB installieren', installingPob: 'PoB wird installiert…', opening: 'PoB wird geöffnet…', pobNotFound: 'Path of Building (PoE2) wurde nicht gefunden. Gib in den Einstellungen den PoB-Ordner an oder installiere PoB dort.',
    pobFolderInvalid: 'In diesem Ordner ist kein PoB (PoE2). Wähle den Ordner mit „Path of Building-PoE2.exe“.',
  },
  fr: {
    connected: 'PoB connecté', disconnected: 'PoB fermé', openPob: 'Ouvrir PoB', newChat: 'Nouvelle discussion', history: 'Historique',
    placeholder: 'Posez une question sur votre build…', send: 'Envoyer', stop: 'Arrêter', thinking: 'En cours…', noAgent: 'Aucun agent IA trouvé. Installez Claude Code ou Codex et connectez-vous.',
    level: 'Niveau', mainSkill: 'Compétence principale', dps: 'DPS', life: 'Vie', es: 'Bouclier d\'énergie', ehp: 'Vie effective', noBuild: 'Aucun build ouvert',
    steps: 'étapes', theme: 'Thème', language: 'Langue', agent: 'Agent', emptyTitle: 'Que faisons-nous avec votre build ?',
    s1: 'Configure PoB pour mesurer correctement mes dégâts', s2: 'Quel passif augmente le plus mes dégâts ?', s3: 'Où changer les réglages de l\'ennemi ?', s4: 'Importe ce code de build',
    deleteChat: 'Supprimer', copied: 'Copié', error: 'Une erreur est survenue',
    windowLanguage: 'Langue de la fenêtre PoB', windowTheme: 'Thème de la fenêtre PoB', pobDefault: 'PoB par défaut', updateAvailable: 'PoB AI {version} est disponible', updateNow: 'Mettre à jour', updating: 'Mise à jour…',
    pobFolder: 'Dossier de PoB', apply: 'Appliquer', installPob: 'Installer PoB', installingPob: 'Installation de PoB…', opening: 'Ouverture de PoB…', pobNotFound: 'Path of Building (PoE2) est introuvable. Indiquez son dossier dans les paramètres ou installez PoB depuis ceux-ci.',
    pobFolderInvalid: 'Aucun PoB (PoE2) dans ce dossier. Choisissez le dossier qui contient « Path of Building-PoE2.exe ».',
  },
  es: {
    connected: 'PoB conectado', disconnected: 'PoB cerrado', openPob: 'Abrir PoB', newChat: 'Nuevo chat', history: 'Historial',
    placeholder: 'Pregunta sobre tu build…', send: 'Enviar', stop: 'Detener', thinking: 'Trabajando…', noAgent: 'No se encontró un agente de IA. Instala Claude Code o Codex e inicia sesión.',
    level: 'Nivel', mainSkill: 'Habilidad principal', dps: 'DPS', life: 'Vida', es: 'Escudo de energía', ehp: 'Vida efectiva', noBuild: 'No hay build abierta',
    steps: 'pasos', theme: 'Tema', language: 'Idioma', agent: 'Agente', emptyTitle: '¿Qué hacemos con tu build?',
    s1: 'Configura PoB para medir bien el daño de mi personaje', s2: '¿Qué pasiva me da más daño?', s3: '¿Dónde cambio la configuración del enemigo?', s4: 'Importa este código de build',
    deleteChat: 'Eliminar', copied: 'Copiado', error: 'Algo salió mal',
    windowLanguage: 'Idioma de la ventana de PoB', windowTheme: 'Tema de la ventana de PoB', pobDefault: 'Predeterminado de PoB', updateAvailable: 'PoB AI {version} está disponible', updateNow: 'Actualizar', updating: 'Actualizando…',
    pobFolder: 'Carpeta de PoB', apply: 'Aplicar', installPob: 'Instalar PoB', installingPob: 'Instalando PoB…', opening: 'Abriendo PoB…', pobNotFound: 'No se encontró Path of Building (PoE2). Indica su carpeta en Ajustes o instala PoB desde ahí.',
    pobFolderInvalid: 'No hay PoB (PoE2) en esa carpeta. Elige la carpeta que contiene «Path of Building-PoE2.exe».',
  },
  'pt-BR': {
    connected: 'PoB conectado', disconnected: 'PoB fechado', openPob: 'Abrir PoB', newChat: 'Nova conversa', history: 'Histórico',
    placeholder: 'Pergunte sobre sua build…', send: 'Enviar', stop: 'Parar', thinking: 'Trabalhando…', noAgent: 'Nenhum agente de IA encontrado. Instale o Claude Code ou o Codex e faça login.',
    level: 'Nível', mainSkill: 'Habilidade principal', dps: 'DPS', life: 'Vida', es: 'Escudo de Energia', ehp: 'Vida efetiva', noBuild: 'Nenhuma build aberta',
    steps: 'passos', theme: 'Tema', language: 'Idioma', agent: 'Agente', emptyTitle: 'O que vamos fazer com sua build?',
    s1: 'Configure o PoB para medir o dano do meu personagem corretamente', s2: 'Qual passiva dá mais dano?', s3: 'Onde mudo as configurações do inimigo?', s4: 'Importe este código de build',
    deleteChat: 'Excluir', copied: 'Copiado', error: 'Algo deu errado',
    windowLanguage: 'Idioma da janela do PoB', windowTheme: 'Tema da janela do PoB', pobDefault: 'Padrão do PoB', updateAvailable: 'PoB AI {version} está disponível', updateNow: 'Atualizar', updating: 'Atualizando…',
    pobFolder: 'Pasta do PoB', apply: 'Aplicar', installPob: 'Instalar o PoB', installingPob: 'Instalando o PoB…', opening: 'Abrindo o PoB…', pobNotFound: 'O Path of Building (PoE2) não foi encontrado. Informe a pasta dele nas configurações ou instale o PoB por lá.',
    pobFolderInvalid: 'Não há PoB (PoE2) nessa pasta. Escolha a pasta que contém "Path of Building-PoE2.exe".',
  },
  th: {
    connected: 'เชื่อมต่อ PoB แล้ว', disconnected: 'ยังไม่ได้เปิด PoB', openPob: 'เปิด PoB', newChat: 'แชทใหม่', history: 'ประวัติ',
    placeholder: 'ถามเกี่ยวกับบิลด์ของคุณ…', send: 'ส่ง', stop: 'หยุด', thinking: 'กำลังทำงาน…', noAgent: 'ไม่พบเอเจนต์ AI ติดตั้งและลงชื่อเข้าใช้ Claude Code หรือ Codex',
    level: 'เลเวล', mainSkill: 'สกิลหลัก', dps: 'DPS', life: 'พลังชีวิต', es: 'โล่พลังงาน', ehp: 'พลังชีวิตที่มีผล', noBuild: 'ยังไม่ได้เปิดบิลด์',
    steps: 'ขั้นตอน', theme: 'ธีม', language: 'ภาษา', agent: 'เอเจนต์', emptyTitle: 'จะทำอะไรกับบิลด์ดี?',
    s1: 'ตั้งค่า PoB ให้คำนวณดาเมจของตัวละครฉันได้ถูกต้อง', s2: 'พาสซีฟไหนเพิ่มดาเมจมากที่สุด?', s3: 'เปลี่ยนการตั้งค่าศัตรูได้ที่ไหน?', s4: 'นำเข้าโค้ดบิลด์นี้',
    deleteChat: 'ลบ', copied: 'คัดลอกแล้ว', error: 'เกิดข้อผิดพลาด',
    windowLanguage: 'ภาษาของหน้าต่าง PoB', windowTheme: 'ธีมของหน้าต่าง PoB', pobDefault: 'ค่าเริ่มต้นของ PoB', updateAvailable: 'มี PoB AI {version} ให้อัปเดตแล้ว', updateNow: 'อัปเดต', updating: 'กำลังอัปเดต…',
    pobFolder: 'โฟลเดอร์ PoB', apply: 'ใช้', installPob: 'ติดตั้ง PoB', installingPob: 'กำลังติดตั้ง PoB…', opening: 'กำลังเปิด PoB…', pobNotFound: 'ไม่พบ Path of Building (PoE2) ระบุโฟลเดอร์ของ PoB ในการตั้งค่า หรือติดตั้ง PoB จากที่นั่น',
    pobFolderInvalid: 'ไม่พบ PoB (PoE2) ในโฟลเดอร์นั้น เลือกโฟลเดอร์ที่มี "Path of Building-PoE2.exe"',
  },
};

export function detectLocale() {
  const saved = (() => { try { return localStorage.getItem('pobai.locale'); } catch { return null; } })();
  if (saved && STRINGS[saved]) return saved;
  for (const lang of navigator.languages ?? [navigator.language]) {
    if (/^zh-(TW|HK|Hant)/i.test(lang)) return 'zh-Hant';
    if (/^pt/i.test(lang)) return 'pt-BR';
    const base = lang.split('-')[0];
    if (STRINGS[base]) return base;
  }
  return 'en';
}

let current = detectLocale();
export const locale = () => current;
export function setLocale(next) {
  current = STRINGS[next] ? next : 'en';
  try { localStorage.setItem('pobai.locale', current); } catch { /* private window */ }
  document.documentElement.lang = current;
}
export const t = key => STRINGS[current]?.[key] ?? STRINGS.en[key] ?? key;
