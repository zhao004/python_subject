import {createElement, useCallback, useEffect, useMemo, useState} from 'react';
import ReactECharts from 'echarts-for-react';
import {
    Activity,
    ArrowLeft,
    BarChart3,
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Database,
    ExternalLink,
    LayoutDashboard,
    LockKeyhole,
    LogIn,
    LogOut,
    MapPin,
    Menu,
    MonitorSmartphone,
    Moon,
    Pencil,
    Plus,
    RotateCcw,
    Save,
    Search,
    ShieldCheck,
    Star,
    Sun,
    Trash2,
    Trophy,
    UserRound,
    X,
} from 'lucide-react';
import {Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import {
    batchDeleteAccessLogs,
    batchDeleteLeaderboardRecords,
    batchDeleteQuestionBanks,
    batchDeleteSubmissionLogs,
    createAdminLeaderboardRecord,
    createAdminQuestionBank,
    deleteAdminLeaderboardRecord,
    deleteAdminQuestionBank,
    fetchAdminAccessLogs,
    fetchAdminLeaderboard,
    fetchAdminOverview,
    fetchAdminQuestionBank,
    fetchAdminQuestionBanks,
    fetchAdminSession,
    fetchBankSubmissionLogs,
    fetchDefaultQuestionBank,
    fetchLeaderboardBySlug,
    fetchQuizBySlug,
    fetchRandomSlug,
    fetchSiteSettings,
    fetchSubmissionStyles,
    fetchSubmissionTrend,
    loginAdmin,
    logoutAdmin,
    submitAccessLog,
    submitScoreBySlug,
    updateAdminLeaderboardRecord,
    updateAdminQuestionBank,
    updateSiteSettings,
} from './api.js';

const DEFAULT_MESSAGE = '先点击任意英文或中文，计时从第一次操作开始';
const ONE_SECOND_MS = 1000;
const TOAST_LIFETIME_MS = 3000;
const LEADERBOARD_FALLBACK_LIMIT = 50;
const ADMIN_LEADERBOARD_LIMIT = 100;
const APP_TIME_ZONE = 'Asia/Shanghai';
const STUDENT_ID_LENGTH = 9;
const STUDENT_ID_PATTERN = /^\d{9}$/;
const ADMIN_CREDENTIAL_STORAGE_KEY = 'quizAdminCredentials:v1';
const ADMIN_SIDEBAR_STORAGE_KEY = 'quizAdminSidebar:v1';
const ADMIN_THEME_STORAGE_KEY = 'quizAdminTheme:v1';
const ADMIN_THEME_LIGHT = 'light';
const ADMIN_THEME_DARK = 'dark';
const ADMIN_USERNAME_LIMIT = 80;
const ADMIN_PASSWORD_LIMIT = 200;
const SITE_TITLE = String(import.meta.env.VITE_SITE_TITLE ?? '配对检测系统').trim() || '配对检测系统';
const FIELD_LIMITS = {
    studentClass: 40, studentId: STUDENT_ID_LENGTH, studentName: 40,
};
const DEFAULT_STUDENT_FORM = {
    studentClass: '', studentId: '', studentName: '',
};
const DEFAULT_ADMIN_LOGIN_FORM = {
    username: '', password: '', rememberCredentials: false,
};
const DEFAULT_BANK_FORM = {
    name: '',
    slug: '',
    description: '',
    announcement: '',
    is_active: true,
    leaderboard_limit: 10,
    submission_style: 'classic',
    items: [{left_text: '', right_text: ''}],
};
const DEFAULT_RECORD_FORM = {
    id: null, student_class: '', student_id: '', student_name: '', correct_count: 0, elapsed_seconds: 0, score: '',
};
const ADMIN_NAV_ITEMS = [{path: '/admin', label: '概览', Icon: LayoutDashboard, end: true}, {
    path: '/admin/banks', label: '题库管理', Icon: BookOpen, end: false
}, {path: '/admin/access-logs', label: '访问日志', Icon: Activity, end: false},];
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const SEARCH_DEBOUNCE_MS = 300;
const AUTO_SAVE_DEBOUNCE_MS = 500;
const AUTO_SAVE_STATUS_IDLE = 'idle';
const AUTO_SAVE_STATUS_SAVING = 'saving';
const AUTO_SAVE_STATUS_SAVED = 'saved';
const AUTO_SAVE_STATUS_ERROR = 'error';
let nextToastId = 1;

/**
 * 解析当前浏览器路径，避免未知路径导致空白页。
 *
 * @returns {object} 当前前端路由。
 */
function readRoute(pathname = window.location.pathname) {
    const path = pathname;
    if (path.startsWith('/admin')) {
        return {page: 'admin', path};
    }
    const publicMatch = path.match(/^\/b\/([^/]+)(?:\/(leaderboard))?$/);
    if (publicMatch) {
        return {
            page: publicMatch[2] === 'leaderboard' ? 'leaderboard' : 'quiz',
            slug: decodeURIComponent(publicMatch[1]),
            path,
        };
    }
    return {page: 'home', path};
}

/**
 * Fisher-Yates 洗牌，返回新数组避免修改原始数据。
 *
 * @param {Array<object>} items 待随机排序的数组。
 * @returns {Array<object>} 随机后的新数组。
 */
function shuffleItems(items) {
    const copiedItems = [...items];
    for (let index = copiedItems.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [copiedItems[index], copiedItems[randomIndex]] = [copiedItems[randomIndex], copiedItems[index]];
    }
    return copiedItems;
}

/**
 * 将秒数格式化为 mm:ss 或 h:mm:ss。
 *
 * @param {number} totalSeconds 总秒数。
 * @returns {string} 展示用时间。
 */
function formatElapsedTime(totalSeconds) {
    const safeSeconds = Math.max(0, Number.isFinite(Number(totalSeconds)) ? Number(totalSeconds) : 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 将服务端时间按应用时区格式化为可读时间。
 *
 * @param {string} submittedAt 服务端返回的 ISO 时间。
 * @returns {string} 本地时间文本。
 */
function formatSubmittedTime(submittedAt) {
    const submittedDate = new Date(submittedAt);
    if (Number.isNaN(submittedDate.getTime())) {
        return '时间未知';
    }
    return submittedDate.toLocaleString('zh-CN', {
        timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
}

/**
 * 构建左右两列卡片。
 *
 * @param {Array<object>} wordPairs 后端返回的配对题目。
 * @returns {{leftItems: Array<object>, rightItems: Array<object>}} 随机后的左右列表。
 */
function buildBoard(wordPairs) {
    const leftItems = wordPairs.map((item) => ({
        uid: `left-${item.id}`, pairId: item.id, side: 'left', text: item.left_text,
    }));
    const rightItems = wordPairs.map((item) => ({
        uid: `right-${item.id}`, pairId: item.id, side: 'right', text: item.right_text,
    }));

    return {
        leftItems: shuffleItems(leftItems), rightItems: shuffleItems(rightItems),
    };
}

/**
 * 生成题库隔离的学生信息存储键。
 *
 * @param {string} slug 题库标识。
 * @returns {string} localStorage 键。
 */
function studentProfileStorageKey(slug) {
    return `wordMatchStudentProfile:v2:${slug}`;
}

/**
 * 将学生信息统一裁剪并去除首尾空白。
 *
 * @param {object} form 学生信息表单。
 * @returns {object} 标准化后的学生信息。
 */
function normalizeStudentForm(form) {
    return {
        studentClass: String(form.studentClass ?? '').trim().slice(0, FIELD_LIMITS.studentClass),
        studentId: String(form.studentId ?? '').trim().slice(0, FIELD_LIMITS.studentId),
        studentName: String(form.studentName ?? '').trim().slice(0, FIELD_LIMITS.studentName),
    };
}

/**
 * 校验学生信息，返回第一个错误提示。
 *
 * @param {object} form 学生信息表单。
 * @returns {string} 错误提示，空字符串表示通过。
 */
function validateStudentForm(form) {
    const normalizedForm = normalizeStudentForm(form);
    const requiredFields = [['studentClass', '班级'], ['studentId', '学号'], ['studentName', '姓名'],];

    for (const [fieldName, label] of requiredFields) {
        const value = normalizedForm[fieldName];
        if (!value) {
            return `请填写${label}`;
        }
    }

    if (!STUDENT_ID_PATTERN.test(normalizedForm.studentId)) {
        return `学号必须是 ${STUDENT_ID_LENGTH} 位数字`;
    }

    return '';
}

/**
 * 读取题库内记住的学生信息。
 *
 * @param {string} slug 题库标识。
 * @returns {{form: object, rememberStudent: boolean}} 本地记忆状态。
 */
function readRememberedStudentProfile(slug) {
    try {
        const rawProfile = window.localStorage.getItem(studentProfileStorageKey(slug));
        if (!rawProfile) {
            return {form: {...DEFAULT_STUDENT_FORM}, rememberStudent: false};
        }
        const parsedProfile = JSON.parse(rawProfile);
        return {
            form: normalizeStudentForm(parsedProfile), rememberStudent: true,
        };
    } catch {
        return {form: {...DEFAULT_STUDENT_FORM}, rememberStudent: false};
    }
}

/**
 * 保存学生信息到本地。
 *
 * @param {string} slug 题库标识。
 * @param {object} form 已通过校验的学生信息。
 * @returns {boolean} 是否保存成功。
 */
function saveRememberedStudentProfile(slug, form) {
    try {
        window.localStorage.setItem(studentProfileStorageKey(slug), JSON.stringify(normalizeStudentForm(form)));
        return true;
    } catch {
        return false;
    }
}

/**
 * 清除题库内记住的学生信息。
 *
 * @param {string} slug 题库标识。
 */
function removeRememberedStudentProfile(slug) {
    try {
        window.localStorage.removeItem(studentProfileStorageKey(slug));
    } catch {
        // 浏览器可能禁用本地存储，清理失败时保持静默，后续提交仍由表单校验兜底。
    }
}

/**
 * 标准化后台登录表单，限制长度以避免脏数据撑破输入框。
 *
 * @param {object} form 后台登录表单。
 * @returns {object} 标准化后的登录表单。
 */
function normalizeAdminLoginForm(form) {
    return {
        username: String(form.username ?? '').trim().slice(0, ADMIN_USERNAME_LIMIT),
        password: String(form.password ?? '').trim().slice(0, ADMIN_PASSWORD_LIMIT),
        rememberCredentials: Boolean(form.rememberCredentials),
    };
}

/**
 * 清除本地保存的后台账号密码。
 */
function clearRememberedAdminCredentials() {
    try {
        window.localStorage.removeItem(ADMIN_CREDENTIAL_STORAGE_KEY);
    } catch {
        // 本地存储不可用时保持静默，登录流程仍由表单和服务端校验兜底。
    }
}

/**
 * 读取本地保存的后台账号密码。
 *
 * @returns {{form: object, hasStored: boolean}} 登录表单初始值和是否存在本地保存。
 */
function readRememberedAdminCredentials() {
    try {
        const rawCredentials = window.localStorage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY);
        if (!rawCredentials) {
            return {form: {...DEFAULT_ADMIN_LOGIN_FORM}, hasStored: false};
        }
        const parsedCredentials = JSON.parse(rawCredentials);
        const form = normalizeAdminLoginForm(parsedCredentials);
        if (!form.rememberCredentials || !form.username || !form.password) {
            clearRememberedAdminCredentials();
            return {form: {...DEFAULT_ADMIN_LOGIN_FORM}, hasStored: false};
        }
        return {form, hasStored: true};
    } catch {
        clearRememberedAdminCredentials();
        return {form: {...DEFAULT_ADMIN_LOGIN_FORM}, hasStored: false};
    }
}

/**
 * 将 Set 复制后切换单个 ID，避免直接修改 React 状态对象。
 *
 * @param {Set<number>} currentIds 当前选中 ID。
 * @param {number} itemId 目标 ID。
 * @returns {Set<number>} 新选中集合。
 */
function toggleSelectionId(currentIds, itemId) {
    const nextIds = new Set(currentIds);
    if (nextIds.has(itemId)) {
        nextIds.delete(itemId);
    } else {
        nextIds.add(itemId);
    }
    return nextIds;
}

/**
 * 判断当前页是否已经全部选中。
 *
 * @param {Array<{id: number}>} entries 当前页记录。
 * @param {Set<number>} selectedIds 已选 ID。
 * @returns {boolean} 是否全选。
 */
function areAllEntriesSelected(entries, selectedIds) {
    return entries.length > 0 && entries.every((entry) => selectedIds.has(entry.id));
}

/**
 * 读取后台主题偏好。
 *
 * @returns {'light' | 'dark'} 已保存的主题，异常时回退浅色模式。
 */
function readStoredAdminTheme() {
    try {
        return window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === ADMIN_THEME_DARK ? ADMIN_THEME_DARK : ADMIN_THEME_LIGHT;
    } catch {
        return ADMIN_THEME_LIGHT;
    }
}

/**
 * 保存后台账号密码到当前浏览器。
 *
 * @param {object} form 已提交的登录表单。
 * @returns {boolean} 是否保存成功。
 */
function saveRememberedAdminCredentials(form) {
    const normalizedForm = normalizeAdminLoginForm(form);
    if (!normalizedForm.rememberCredentials || !normalizedForm.username || !normalizedForm.password) {
        clearRememberedAdminCredentials();
        return false;
    }
    try {
        window.localStorage.setItem(ADMIN_CREDENTIAL_STORAGE_KEY, JSON.stringify(normalizedForm));
        return true;
    } catch {
        return false;
    }
}

/**
 * 复制默认题库表单，避免不同表单实例共享题目数组。
 *
 * @returns {object} 新表单。
 */
function createEmptyBankForm() {
    return {
        ...DEFAULT_BANK_FORM, items: DEFAULT_BANK_FORM.items.map((item) => ({...item})),
    };
}

/**
 * 将题库详情转成后台可编辑表单。
 *
 * @param {object} bank 题库详情。
 * @returns {object} 表单值。
 */
function bankToForm(bank) {
    return {
        name: bank.name,
        slug: bank.slug,
        description: bank.description,
        announcement: bank.announcement ?? '',
        is_active: bank.is_active,
        leaderboard_limit: bank.leaderboard_limit,
        submission_style: bank.submission_style,
        items: bank.items.length > 0 ? bank.items.map((item) => ({
            left_text: item.left_text, right_text: item.right_text
        })) : [{left_text: '', right_text: ''}],
    };
}

/**
 * 标准化题库表单，过滤完全空白的题目行。
 *
 * @param {object} form 后台题库表单。
 * @returns {object} API 载荷。
 */
function normalizeBankPayload(form) {
    return {
        name: String(form.name ?? '').trim(),
        slug: String(form.slug ?? '').trim(),
        description: String(form.description ?? '').trim(),
        announcement: String(form.announcement ?? '').trim(),
        is_active: Boolean(form.is_active),
        leaderboard_limit: Number(form.leaderboard_limit) || 10,
        submission_style: form.submission_style || 'classic',
        items: form.items
            .map((item) => ({
                left_text: String(item.left_text ?? '').trim(), right_text: String(item.right_text ?? '').trim(),
            }))
            .filter((item) => item.left_text || item.right_text),
    };
}

/**
 * 标准化后台排行榜表单。
 *
 * @param {object} form 排行榜表单。
 * @returns {object} API 载荷。
 */
function normalizeRecordPayload(form) {
    const payload = {
        student_class: String(form.student_class ?? '').trim(),
        student_id: String(form.student_id ?? '').trim(),
        student_name: String(form.student_name ?? '').trim(),
        correct_count: Number(form.correct_count) || 0,
        elapsed_seconds: Number(form.elapsed_seconds) || 0,
    };
    if (String(form.score ?? '').trim() !== '') {
        payload.score = Number(form.score);
    }
    return payload;
}

/**
 * 单词配对测验主应用。
 *
 * @returns {JSX.Element} 应用界面。
 */
export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const route = useMemo(() => readRoute(location.pathname), [location.pathname]);
    const [toasts, setToasts] = useState([]);
    const [adminTheme, setAdminTheme] = useState(readStoredAdminTheme);

    useEffect(() => {
        document.documentElement.dataset.theme = adminTheme;
        try {
            window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, adminTheme);
        } catch {
            // 本地存储不可用时仅影响主题持久化，不影响后台功能。
        }
    }, [adminTheme]);

    const toggleAdminTheme = useCallback(() => {
        setAdminTheme((currentTheme) => (currentTheme === ADMIN_THEME_DARK ? ADMIN_THEME_LIGHT : ADMIN_THEME_DARK));
    }, []);

    /**
     * 移除指定 Toast。
     *
     * @param {number} toastId Toast 编号。
     */
    const removeToast = useCallback((toastId) => {
        setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
    }, []);

    /**
     * 添加右上角 Toast。
     *
     * @param {string} text Toast 文本。
     * @param {'success' | 'error'} type Toast 类型。
     */
    const addToast = useCallback((text, type) => {
        const id = nextToastId;
        nextToastId += 1;
        setToasts((currentToasts) => [...currentToasts, {id, text, type}]);
        window.setTimeout(() => {
            removeToast(id);
        }, TOAST_LIFETIME_MS);
    }, [removeToast]);

    /**
     * 切换页面，并同步 History API。
     *
     * @param {string} path 目标路径。
     * @param {boolean} replace 是否替换当前历史记录。
     */
    const navigateTo = useCallback((path, replace = false) => {
        navigate(path, {replace});
    }, [navigate]);

    return (<>
        <Routes>
            <Route path="/" element={<PublicApp addToast={addToast} navigateTo={navigateTo} route={route}
                                                siteTitle={SITE_TITLE}/>}/>
            <Route path="/b/:slug" element={<PublicApp addToast={addToast} navigateTo={navigateTo} route={route}
                                                       siteTitle={SITE_TITLE}/>}/>
            <Route path="/b/:slug/leaderboard"
                   element={<PublicApp addToast={addToast} navigateTo={navigateTo} route={route}
                                       siteTitle={SITE_TITLE}/>}/>
            <Route path="/admin/*"
                   element={<AdminApp addToast={addToast} adminTheme={adminTheme} navigateTo={navigateTo}
                                      onToggleTheme={toggleAdminTheme} siteTitle={SITE_TITLE}/>}/>
            <Route path="*" element={<Navigate replace to="/"/>}/>
        </Routes>
        <ToastStack toasts={toasts} onDismiss={removeToast}/>
    </>);
}

/**
 * 公开端入口，处理默认题库跳转、答题页和排行榜页。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 公开端界面。
 */
function PublicApp({route, navigateTo, addToast, siteTitle}) {
    const [homeLoading, setHomeLoading] = useState(route.page === 'home');
    const [quiz, setQuiz] = useState(null);
    const [leftItems, setLeftItems] = useState([]);
    const [rightItems, setRightItems] = useState([]);
    const [selectedItem, setSelectedItem] = useState(null);
    const [matchedPairIds, setMatchedPairIds] = useState(() => new Set());
    const [message, setMessage] = useState(DEFAULT_MESSAGE);
    const [studentForm, setStudentForm] = useState({...DEFAULT_STUDENT_FORM});
    const [rememberStudent, setRememberStudent] = useState(false);
    const [identityError, setIdentityError] = useState('');
    const [isIdentityConfirmed, setIsIdentityConfirmed] = useState(false);
    const [startedAt, setStartedAt] = useState(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [timerStopped, setTimerStopped] = useState(false);
    const [leaderboard, setLeaderboard] = useState([]);
    const [lastResult, setLastResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [publicError, setPublicError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);

    const slug = route.slug ?? '';
    const matchedCount = matchedPairIds.size;
    const score = quiz ? Math.round(matchedCount * quiz.points_per_pair) : 0;
    const totalPairs = quiz?.total_pairs ?? 0;
    const styleClass = quiz ? `public-style-${quiz.question_bank.submission_style}` : 'public-style-classic';
    const shouldShowIdentityModal = route.page === 'quiz' && quiz && !isIdentityConfirmed;

    useEffect(() => {
        if (route.page !== 'home') {
            return undefined;
        }
        let isActive = true;

        async function loadDefaultBank() {
            setHomeLoading(true);
            try {
                const result = await fetchDefaultQuestionBank();
                if (!isActive) {
                    return;
                }
                if (result.question_bank) {
                    navigateTo(`/b/${encodeURIComponent(result.question_bank.slug)}`, true);
                    return;
                }
            } catch (error) {
                addToast(error.message, 'error');
            } finally {
                if (isActive) {
                    setHomeLoading(false);
                }
            }
        }

        loadDefaultBank();
        return () => {
            isActive = false;
        };
    }, [addToast, navigateTo, route.page]);

    useEffect(() => {
        if (!slug) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            const rememberedProfile = readRememberedStudentProfile(slug);
            setStudentForm(rememberedProfile.form);
            setRememberStudent(rememberedProfile.rememberStudent);
            setIdentityError('');
            setIsIdentityConfirmed(false);
            setStartedAt(null);
            setElapsedSeconds(0);
            setTimerStopped(false);
            setLastResult(null);
            setMatchedPairIds(new Set());
            setSelectedItem(null);
            setMessage(DEFAULT_MESSAGE);
        }, 0);
        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [slug]);

    useEffect(() => {
        if (route.page !== 'quiz' && route.page !== 'leaderboard') {
            return undefined;
        }
        let isActive = true;

        async function loadQuizData() {
            setIsLoading(true);
            setPublicError('');
            try {
                const quizData = await fetchQuizBySlug(route.slug);
                if (!isActive) {
                    return;
                }
                setQuiz(quizData);
                const board = buildBoard(quizData.word_pairs);
                setLeftItems(board.leftItems);
                setRightItems(board.rightItems);
            } catch (error) {
                if (isActive) {
                    setPublicError(error.message);
                }
                addToast(error.message, 'error');
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        loadQuizData();
        return () => {
            isActive = false;
        };
    }, [addToast, route.page, route.slug]);

    useEffect(() => {
        if (route.page !== 'leaderboard' || !route.slug) {
            return undefined;
        }
        let isActive = true;

        async function loadLeaderboardData() {
            setIsLeaderboardLoading(true);
            try {
                const leaderboardData = await fetchLeaderboardBySlug(route.slug, LEADERBOARD_FALLBACK_LIMIT);
                if (isActive) {
                    setLeaderboard(leaderboardData.entries);
                }
            } catch (error) {
                addToast(error.message, 'error');
            } finally {
                if (isActive) {
                    setIsLeaderboardLoading(false);
                }
            }
        }

        loadLeaderboardData();
        return () => {
            isActive = false;
        };
    }, [addToast, route.page, route.slug]);

    useEffect(() => {
        if ((route.page !== 'quiz' && route.page !== 'leaderboard') || !route.slug) {
            return;
        }
        submitAccessLog({
            page_path: route.path, question_bank_slug: route.slug,
        }).catch(() => {
            // 访问记录失败不能影响答题和排行榜浏览。
        });
    }, [route.page, route.path, route.slug]);

    useEffect(() => {
        if (startedAt === null || timerStopped) {
            return undefined;
        }
        const intervalId = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startedAt) / ONE_SECOND_MS));
        }, ONE_SECOND_MS);
        return () => {
            clearInterval(intervalId);
        };
    }, [startedAt, timerStopped]);

    const selectedLookup = useMemo(() => {
        const items = [...leftItems, ...rightItems];
        return new Map(items.map((item) => [item.uid, item]));
    }, [leftItems, rightItems]);

    /**
     * 设置操作提示。
     *
     * @param {string} nextMessage 提示文本。
     */
    function showStatus(nextMessage) {
        setMessage(nextMessage);
    }

    /**
     * 首次作答时启动计时。
     */
    function ensureTimerStarted() {
        if (startedAt === null && !timerStopped) {
            setStartedAt(Date.now());
        }
    }

    /**
     * 停止计时并固化当前耗时。
     */
    function stopTimer() {
        if (startedAt === null) {
            setTimerStopped(true);
            return;
        }
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / ONE_SECOND_MS));
        setTimerStopped(true);
    }

    /**
     * 处理学生信息输入。
     *
     * @param {string} fieldName 字段名。
     * @param {string} value 输入值。
     */
    function updateStudentForm(fieldName, value) {
        const maxLength = FIELD_LIMITS[fieldName];
        setStudentForm((currentForm) => ({
            ...currentForm, [fieldName]: value.slice(0, maxLength),
        }));
        if (identityError) {
            setIdentityError('');
        }
    }

    /**
     * 确认入场身份信息。
     */
    function confirmStudentIdentity() {
        const validationMessage = validateStudentForm(studentForm);
        if (validationMessage) {
            setIdentityError(validationMessage);
            return;
        }
        const normalizedForm = normalizeStudentForm(studentForm);
        setStudentForm(normalizedForm);
        if (rememberStudent) {
            const isSaved = saveRememberedStudentProfile(slug, normalizedForm);
            if (!isSaved) {
                addToast('浏览器无法记住学生信息，本次仍可继续答题', 'error');
            }
        } else {
            removeRememberedStudentProfile(slug);
        }
        setIdentityError('');
        setIsIdentityConfirmed(true);
        showStatus('身份信息已确认，点击卡片开始计时');
    }

    /**
     * 重置当前测验状态并重新洗牌。
     */
    function resetGame() {
        if (!quiz) {
            return;
        }
        const board = buildBoard(quiz.word_pairs);
        setLeftItems(board.leftItems);
        setRightItems(board.rightItems);
        setSelectedItem(null);
        setMatchedPairIds(new Set());
        setStartedAt(null);
        setElapsedSeconds(0);
        setTimerStopped(false);
        setLastResult(null);
        showStatus('已重新随机排序，计时将在下一次点击时开始');
    }

    /**
     * 尝试完成一次配对。
     *
     * @param {object} firstItem 已选卡片。
     * @param {object} secondItem 当前点击卡片。
     */
    function attemptMatch(firstItem, secondItem) {
        const leftItem = firstItem.side === 'left' ? firstItem : secondItem;
        const rightItem = firstItem.side === 'right' ? firstItem : secondItem;

        if (leftItem.pairId !== rightItem.pairId) {
            setSelectedItem(null);
            showStatus(DEFAULT_MESSAGE);
            addToast(`配对错误：${leftItem.text} 不是 ${rightItem.text}`, 'error');
            return;
        }

        const nextMatchedPairIds = new Set(matchedPairIds);
        nextMatchedPairIds.add(leftItem.pairId);
        setMatchedPairIds(nextMatchedPairIds);
        setSelectedItem(null);

        const nextMatchedCount = nextMatchedPairIds.size;
        if (quiz && nextMatchedCount === quiz.total_pairs) {
            stopTimer();
            showStatus('全部配对完成，可以提交成绩');
            addToast('全部配对完成，可以提交成绩', 'success');
            return;
        }

        showStatus('配对成功，继续选择下一组');
        addToast(`配对成功：${leftItem.text} 对应 ${rightItem.text}`, 'success');
    }

    /**
     * 处理卡片点击。
     *
     * @param {object} item 当前点击的卡片。
     */
    function handleCardClick(item) {
        if (matchedPairIds.has(item.pairId)) {
            addToast('这一项已经配对成功，请选择其他卡片', 'error');
            return;
        }
        ensureTimerStarted();
        if (selectedItem === null || selectedItem.side === item.side) {
            setSelectedItem(item);
            showStatus(item.side === 'left' ? '已选左侧，请点击对应右侧' : '已选右侧，请点击对应左侧');
            return;
        }
        const activeSelectedItem = selectedLookup.get(selectedItem.uid);
        if (!activeSelectedItem || matchedPairIds.has(activeSelectedItem.pairId)) {
            setSelectedItem(null);
            showStatus(DEFAULT_MESSAGE);
            addToast('上一次选择已失效，请重新选择', 'error');
            return;
        }
        attemptMatch(activeSelectedItem, item);
    }

    /**
     * 提交当前成绩。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleSubmitScore() {
        if (!quiz || quiz.total_pairs === 0) {
            addToast('当前题库暂无题目，无法提交成绩', 'error');
            return;
        }
        const validationMessage = validateStudentForm(studentForm);
        if (validationMessage) {
            addToast(validationMessage, 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            const normalizedForm = normalizeStudentForm(studentForm);
            if (rememberStudent) {
                saveRememberedStudentProfile(slug, normalizedForm);
            }
            const liveElapsedSeconds = startedAt === null || timerStopped ? elapsedSeconds : Math.floor((Date.now() - startedAt) / ONE_SECOND_MS);
            const result = await submitScoreBySlug(slug, {
                student_class: normalizedForm.studentClass,
                student_id: normalizedForm.studentId,
                student_name: normalizedForm.studentName,
                elapsed_seconds: liveElapsedSeconds,
                matched_pair_ids: Array.from(matchedPairIds),
            });
            setLastResult(result);
            setElapsedSeconds(liveElapsedSeconds);
            showStatus('成绩已提交，可继续练习或查看排行榜');
            addToast(result.saved_as_best ? '成绩已保存为个人最佳记录' : '本次成绩未超过个人最佳记录', 'success');
        } catch (error) {
            addToast(error.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    }

    if (route.page === 'home') {
        return <HomePage isLoading={homeLoading}/>;
    }

    if (route.page === 'leaderboard') {
        return (<LeaderboardPage
            entries={leaderboard}
            isLoading={isLeaderboardLoading || isLoading}
            publicError={publicError}
            quiz={quiz}
            siteTitle={siteTitle}
            styleClass={styleClass}
            onNavigateHome={() => navigateTo(`/b/${encodeURIComponent(slug)}`)}
        />);
    }

    return (<>
        <QuizPage
            elapsedSeconds={elapsedSeconds}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
            lastResult={lastResult}
            leftItems={leftItems}
            matchedCount={matchedCount}
            matchedPairIds={matchedPairIds}
            message={message}
            publicError={publicError}
            quiz={quiz}
            rightItems={rightItems}
            score={score}
            selectedItem={selectedItem}
            siteTitle={siteTitle}
            studentForm={studentForm}
            styleClass={styleClass}
            totalPairs={totalPairs}
            onCardClick={handleCardClick}
            onNavigateLeaderboard={() => navigateTo(`/b/${encodeURIComponent(slug)}/leaderboard`)}
            onResetGame={resetGame}
            onStudentFormChange={updateStudentForm}
            onSubmitScore={handleSubmitScore}
        />
        {shouldShowIdentityModal && (<StudentIdentityModal
            errorMessage={identityError}
            form={studentForm}
            rememberStudent={rememberStudent}
            onConfirm={confirmStudentIdentity}
            onFormChange={updateStudentForm}
            onRememberChange={setRememberStudent}
        />)}
    </>);
}

/**
 * 无默认题库时的入口页。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 入口页。
 */
function HomePage({isLoading}) {
    return (<main className="home-shell">
        <section className="home-panel">
            <p className="eyebrow">题库系统</p>
            <h1>{isLoading ? '正在读取默认题库' : '尚未配置默认题库'}</h1>
            <p>请进入后台创建题库，并设置主域名默认跳转题库。</p>
        </section>
    </main>);
}

/**
 * 答题页面。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 答题页面。
 */
function QuizPage({
                      quiz,
                      leftItems,
                      rightItems,
                      matchedPairIds,
                      selectedItem,
                      studentForm,
                      message,
                      matchedCount,
                      totalPairs,
                      score,
                      elapsedSeconds,
                      lastResult,
                      isLoading,
                      publicError,
                      isSubmitting,
                      styleClass,
                      siteTitle,
                      onCardClick,
                      onResetGame,
                      onSubmitScore,
                      onStudentFormChange,
                      onNavigateLeaderboard,
                  }) {
    if (isLoading) {
        return <LoadingPage text="正在加载题库..."/>;
    }

    if (publicError || !quiz) {
        return <LoadingPage text={publicError || '题库数据不可用，请刷新页面重试。'}/>;
    }

    return (<main className={`page-shell quiz-page-shell ${styleClass}`}>
        <section className="exam-board">
            <header className="exam-header">
                <div className="exam-copy">
                    <p className="eyebrow">{quiz.question_bank.name}</p>
                    <h1>{siteTitle}</h1>
                    {quiz.question_bank.description && <p className="exam-lede">{quiz.question_bank.description}</p>}
                </div>
                <div className="student-form" aria-label="学生信息">
                    <StudentFields form={studentForm} onChange={onStudentFormChange}/>
                </div>
            </header>

            <section className="status-grid" aria-label="测验状态">
                <StatusCard label="配对" value={`${matchedCount}/${totalPairs}`}/>
                <StatusCard label="得分" value={`${score}/100`}/>
                <StatusCard label="用时" value={formatElapsedTime(elapsedSeconds)} variant="timer-card"/>
                <div className="message-card" role="status" aria-live="polite">{message}</div>
            </section>

            <section className="content-grid quiz-content-grid">
                <div className="match-panel">
                    {quiz.total_pairs === 0 ? (<p className="empty-state">当前题库暂无题目，请联系管理员。</p>) : (<>
                        <div className="table-head">
                            <span>左侧</span>
                            <span>右侧</span>
                        </div>
                        <div className="match-table" role="list">
                            {leftItems.map((leftItem, index) => {
                                const rightItem = rightItems[index];
                                return (<div className="match-row" key={`${leftItem.uid}-${rightItem.uid}`}>
                                    <MatchCard
                                        isMatched={matchedPairIds.has(leftItem.pairId)}
                                        isSelected={selectedItem?.uid === leftItem.uid}
                                        item={leftItem}
                                        onClick={onCardClick}
                                    />
                                    <MatchCard
                                        isMatched={matchedPairIds.has(rightItem.pairId)}
                                        isSelected={selectedItem?.uid === rightItem.uid}
                                        item={rightItem}
                                        onClick={onCardClick}
                                    />
                                </div>);
                            })}
                        </div>
                    </>)}
                    <div className="action-row">
                        <button className="secondary-button" type="button" onClick={onResetGame}>重新随机排序</button>
                        <button className="secondary-button" type="button" onClick={onNavigateLeaderboard}>查看排行榜
                        </button>
                        <button
                            className="primary-button"
                            type="button"
                            disabled={isSubmitting || quiz.total_pairs === 0}
                            onClick={onSubmitScore}
                        >
                            {isSubmitting ? '正在保存...' : '提交成绩'}
                        </button>
                    </div>
                    {lastResult && <ResultPanel result={lastResult}/>}
                </div>
            </section>
        </section>
    </main>);
}

/**
 * 学生信息字段组。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 字段组。
 */
function StudentFields({form, onChange}) {
    return (<>
        <label>
            <span>班级</span>
            <input
                value={form.studentClass}
                maxLength={FIELD_LIMITS.studentClass}
                onChange={(event) => onChange('studentClass', event.target.value)}
                placeholder="例如：一班"
            />
        </label>
        <label>
            <span>学号</span>
            <input
                value={form.studentId}
                inputMode="numeric"
                maxLength={FIELD_LIMITS.studentId}
                onChange={(event) => onChange('studentId', event.target.value)}
                placeholder="例如：001234567"
            />
        </label>
        <label>
            <span>姓名</span>
            <input
                value={form.studentName}
                maxLength={FIELD_LIMITS.studentName}
                onChange={(event) => onChange('studentName', event.target.value)}
                placeholder="例如：张三"
            />
        </label>
    </>);
}

/**
 * 状态卡片。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 状态节点。
 */
function StatusCard({label, value, variant = ''}) {
    return (<div className={`status-card ${variant}`}>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>);
}

/**
 * 独立排行榜页面。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 排行榜页面。
 */
function LeaderboardPage({quiz, entries, isLoading, publicError, siteTitle, styleClass, onNavigateHome}) {
    if (isLoading && !quiz) {
        return <LoadingPage text="正在加载排行榜..."/>;
    }

    if (publicError || !quiz) {
        return <LoadingPage text={publicError || '排行榜数据不可用，请刷新页面重试。'}/>;
    }

    return (<main className={`page-shell leaderboard-page-shell ${styleClass}`}>
        <section className="leaderboard-page">
            <header className="leaderboard-hero">
                <div>
                    <p className="eyebrow">{quiz.question_bank.name}</p>
                    <h1>{siteTitle}排行榜</h1>
                    <p className="exam-lede">显示前 {quiz.question_bank.leaderboard_limit} 名，同分时用时更短排名更靠前。</p>
                </div>
                <button className="secondary-button hero-button" type="button" onClick={onNavigateHome}>返回答题
                </button>
            </header>
            <LeaderboardPanel entries={entries} isLoading={isLoading}/>
        </section>
    </main>);
}

/**
 * 排行榜面板。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 排行榜列表。
 */
function LeaderboardPanel({entries, isLoading}) {
    return (<section className="leaderboard-page-panel" aria-label="排行榜">
        {isLoading ? (<div className="loading-panel compact-loading">正在加载排行榜...</div>) : entries.length === 0 ? (
            <p className="empty-state leaderboard-empty">暂无成绩，提交后会出现在这里。</p>) : (<>
            <div className="leaderboard-table" role="table" aria-label="排行榜">
                <div className="leaderboard-table-row leaderboard-table-head" role="row">
                    <span role="columnheader">排名</span>
                    <span role="columnheader">学生</span>
                    <span role="columnheader">班级</span>
                    <span role="columnheader">学号</span>
                    <span role="columnheader">分数</span>
                    <span role="columnheader">正确数</span>
                    <span role="columnheader">用时</span>
                    <span role="columnheader">提交时间</span>
                </div>
                {entries.map((entry) => <LeaderboardTableRow entry={entry} key={entry.id}/>)}
            </div>
            <ol className="leaderboard-card-list">
                {entries.map((entry) => <LeaderboardCard entry={entry} key={entry.id}/>)}
            </ol>
        </>)}
    </section>);
}

/**
 * PC 端排行榜行。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 表格行。
 */
function LeaderboardTableRow({entry}) {
    return (<div className="leaderboard-table-row" role="row">
        <span className="rank rank-inline" role="cell">{entry.rank}</span>
        <strong role="cell">{entry.student_name}</strong>
        <span role="cell">{entry.student_class}</span>
        <span role="cell">{entry.student_id}</span>
        <strong className="leaderboard-score" role="cell">{entry.score}</strong>
        <span role="cell">{entry.correct_count}/{entry.total_pairs}</span>
        <span role="cell">{formatElapsedTime(entry.elapsed_seconds)}</span>
        <span role="cell">{formatSubmittedTime(entry.submitted_at)}</span>
    </div>);
}

/**
 * 移动端排行榜卡片。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 卡片节点。
 */
function LeaderboardCard({entry}) {
    return (<li className="leaderboard-card">
        <div className="leaderboard-card-top">
            <span className="rank">{entry.rank}</span>
            <div>
                <strong>{entry.student_name}</strong>
                <small>{entry.student_class} · {entry.student_id}</small>
            </div>
            <strong className="leaderboard-score">{entry.score}</strong>
        </div>
        <dl className="leaderboard-card-meta">
            <div>
                <dt>正确数</dt>
                <dd>{entry.correct_count}/{entry.total_pairs}</dd>
            </div>
            <div>
                <dt>用时</dt>
                <dd>{formatElapsedTime(entry.elapsed_seconds)}</dd>
            </div>
            <div>
                <dt>提交时间</dt>
                <dd>{formatSubmittedTime(entry.submitted_at)}</dd>
            </div>
        </dl>
    </li>);
}

/**
 * 入场身份确认弹窗。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 弹窗节点。
 */
function StudentIdentityModal({errorMessage, form, rememberStudent, onConfirm, onFormChange, onRememberChange}) {
    return (<div className="identity-modal-backdrop" role="presentation">
        <section className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-title">
            <div className="identity-copy">
                <p className="eyebrow">身份确认</p>
                <h2 id="identity-title">请认真填写</h2>
            </div>
            <form
                className="identity-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm();
                }}
            >
                <StudentFields form={form} onChange={onFormChange}/>
                <label className="remember-row">
                    <input
                        checked={rememberStudent}
                        type="checkbox"
                        onChange={(event) => onRememberChange(event.target.checked)}
                    />
                    <span>记住这次填写的信息</span>
                </label>
                {errorMessage && <p className="identity-error" role="alert">{errorMessage}</p>}
                <button className="primary-button identity-submit" type="submit">确认并开始</button>
            </form>
        </section>
    </div>);
}

/**
 * 单张配对卡片。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 卡片节点。
 */
function MatchCard({item, isMatched, isSelected, onClick}) {
    const className = ['match-card', item.side === 'left' ? 'left-card' : 'right-card', isMatched ? 'matched' : '', isSelected ? 'selected' : '',].filter(Boolean).join(' ');

    return (<button
        className={className}
        type="button"
        disabled={isMatched}
        onClick={() => onClick(item)}
    >
        <span>{item.text}</span>
    </button>);
}

/**
 * 提交结果面板。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 结果面板。
 */
function ResultPanel({result}) {
    const {record} = result;
    return (<section className="result-panel">
        <div>
            <span>本次记录</span>
            <strong>{result.saved_as_best ? '已计入最佳成绩' : '未超过最佳成绩'}</strong>
        </div>
        <div>
            <span>学生</span>
            <strong>{record.student_class} · {record.student_name} · {record.student_id}</strong>
        </div>
        <div>
            <span>成绩</span>
            <strong>{record.correct_count}/{record.total_pairs} · {record.score} 分
                · {formatElapsedTime(record.elapsed_seconds)}</strong>
        </div>
    </section>);
}

/**
 * 后台应用。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 后台界面。
 */
function AdminApp({addToast, adminTheme, navigateTo, onToggleTheme, siteTitle}) {
    const location = useLocation();
    const [initialAdminCredentials] = useState(readRememberedAdminCredentials);
    const [session, setSession] = useState({authenticated: false, username: null});
    const [isSessionLoading, setIsSessionLoading] = useState(true);
    const [loginForm, setLoginForm] = useState(initialAdminCredentials.form);
    const [hasRememberedAdminCredentials, setHasRememberedAdminCredentials] = useState(initialAdminCredentials.hasStored);
    const [banks, setBanks] = useState([]);
    const [selectedBankId, setSelectedBankId] = useState(null);
    const [selectedBank, setSelectedBank] = useState(null);
    const [bankForm, setBankForm] = useState(createEmptyBankForm);
    const [siteSettings, setSiteSettings] = useState({
        default_question_bank_id: null, default_question_bank_slug: null
    });
    const [styles, setStyles] = useState([]);
    const [recordForm, setRecordForm] = useState({...DEFAULT_RECORD_FORM});
    const [leaderboardReloadKey, setLeaderboardReloadKey] = useState(0);
    const [isSavingBank, setIsSavingBank] = useState(false);
    const [isSavingRecord, setIsSavingRecord] = useState(false);
    const [isBankModalOpen, setIsBankModalOpen] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [autoSaveStatus, setAutoSaveStatus] = useState(AUTO_SAVE_STATUS_IDLE);
    const [selectedBankIds, setSelectedBankIds] = useState(() => new Set());
    const [banksReloadKey, setBanksReloadKey] = useState(0);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        try {
            return window.localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY) === 'collapsed';
        } catch {
            return false;
        }
    });
    const adminRoute = useMemo(() => {
        const normalizedPath = location.pathname.replace(/\/$/, '') || '/admin';
        const bankRouteMatch = normalizedPath.match(/^\/admin\/banks\/(\d+)\/(questions|leaderboard|logs)$/);
        if (bankRouteMatch) {
            return {page: bankRouteMatch[2], bankId: Number(bankRouteMatch[1])};
        }
        if (normalizedPath === '/admin/banks') {
            return {page: 'banks', bankId: null};
        }
        if (normalizedPath === '/admin/access-logs') {
            return {page: 'access-logs', bankId: null};
        }
        return {page: 'overview', bankId: null};
    }, [location.pathname]);
    const routeBank = useMemo(() => {
        if (!adminRoute.bankId) {
            return selectedBank;
        }
        return banks.find((bank) => bank.id === adminRoute.bankId) ?? selectedBank;
    }, [adminRoute.bankId, banks, selectedBank]);
    const adminPageTitle = useMemo(() => {
        const bankName = routeBank?.name;
        if (adminRoute.page === 'banks') {
            return '题库管理';
        }
        if (adminRoute.page === 'questions') {
            return bankName ? `题目管理 - ${bankName}` : '题目管理';
        }
        if (adminRoute.page === 'leaderboard') {
            return bankName ? `排行榜 - ${bankName}` : '排行榜';
        }
        if (adminRoute.page === 'logs') {
            return bankName ? `提交统计与访问日志 - ${bankName}` : '提交统计与访问日志';
        }
        if (adminRoute.page === 'access-logs') {
            return '访问日志';
        }
        return '概览';
    }, [adminRoute.page, routeBank]);

    /**
     * 读取后台概览数据。
     *
     * @param {number | null} preferredBankId 优先选中的题库 ID。
     * @returns {Promise<void>} 无返回值。
     */
    const loadAdminOverview = useCallback(async (preferredBankId = null) => {
        try {
            const [bankListResponse, settings, styleOptions] = await Promise.all([fetchAdminQuestionBanks(), fetchSiteSettings(), fetchSubmissionStyles()]);
            const bankList = bankListResponse.entries;
            setBanks(bankList);
            setSiteSettings(settings);
            setStyles(styleOptions);
            const preferredId = preferredBankId ?? selectedBankId;
            const nextSelectedId = preferredId && bankList.some((bank) => bank.id === preferredId) ? preferredId : bankList[0]?.id ?? null;
            setSelectedBankId(nextSelectedId);
        } catch (error) {
            addToast(error.message, 'error');
        }
    }, [addToast, selectedBankId]);

    useEffect(() => {
        let isActive = true;

        async function loadSession() {
            try {
                const result = await fetchAdminSession();
                if (isActive) {
                    setSession(result);
                }
            } catch (error) {
                addToast(error.message, 'error');
            } finally {
                if (isActive) {
                    setIsSessionLoading(false);
                }
            }
        }

        loadSession();
        return () => {
            isActive = false;
        };
    }, [addToast]);

    useEffect(() => {
        if (session.authenticated) {
            const timeoutId = window.setTimeout(() => {
                loadAdminOverview();
            }, 0);
            return () => {
                window.clearTimeout(timeoutId);
            };
        }
        return undefined;
    }, [loadAdminOverview, session.authenticated]);

    useEffect(() => {
        if (!session.authenticated || selectedBankId === null) {
            const timeoutId = window.setTimeout(() => {
                setSelectedBank(null);
            }, 0);
            return () => {
                window.clearTimeout(timeoutId);
            };
        }
        let isActive = true;

        async function loadSelectedBank() {
            try {
                const detail = await fetchAdminQuestionBank(selectedBankId);
                if (!isActive) {
                    return;
                }
                setSelectedBank(detail);
                setBankForm(bankToForm(detail));
                setRecordForm({...DEFAULT_RECORD_FORM});
            } catch (error) {
                addToast(error.message, 'error');
            }
        }

        loadSelectedBank();
        return () => {
            isActive = false;
        };
    }, [addToast, selectedBankId, session.authenticated]);

    useEffect(() => {
        if (!session.authenticated || !adminRoute.bankId || selectedBankId === adminRoute.bankId) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            setSelectedBankId(adminRoute.bankId);
        }, 0);
        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [adminRoute.bankId, selectedBankId, session.authenticated]);

    useEffect(() => {
        try {
            window.localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, isSidebarCollapsed ? 'collapsed' : 'expanded');
        } catch {
            // 本地存储不可用时只影响侧栏偏好，不影响后台功能。
        }
    }, [isSidebarCollapsed]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setIsMobileSidebarOpen(false);
        }, 0);
        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [location.pathname]);

    /**
     * 题目管理页自动保存：监听 bankForm.items 变化，debounce 后自动提交。
     * 仅在题目管理页（questions）且已存在 selectedBank 时生效。
     * 过滤不完整题目行，不足最小题目数时跳过保存。
     */
    useEffect(() => {
        if (adminRoute.page !== 'questions' || !selectedBank) {
            return undefined;
        }
        const completeItems = bankForm.items.filter((item) => item.left_text.trim() && item.right_text.trim());
        if (bankForm.items.length > 0 && completeItems.length === 0) {
            return undefined;
        }
        const timerId = window.setTimeout(async () => {
            setAutoSaveStatus(AUTO_SAVE_STATUS_SAVING);
            try {
                const payload = normalizeBankPayload(bankForm);
                const validItems = payload.items.filter((item) => item.left_text && item.right_text);
                if (bankForm.items.length > 0 && validItems.length === 0) {
                    return;
                }
                await updateAdminQuestionBank(selectedBank.id, payload);
                setAutoSaveStatus(AUTO_SAVE_STATUS_SAVED);
            } catch (error) {
                setAutoSaveStatus(AUTO_SAVE_STATUS_ERROR);
                addToast(error.message, 'error');
            }
        }, AUTO_SAVE_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timerId);
        };
    }, [bankForm, adminRoute.page, selectedBank, addToast]);

    /**
     * 提交登录表单。
     *
     * @param {SubmitEvent} event 表单事件。
     * @returns {Promise<void>} 无返回值。
     */
    async function handleLogin(event) {
        event.preventDefault();
        try {
            const normalizedForm = normalizeAdminLoginForm(loginForm);
            const result = await loginAdmin({
                username: normalizedForm.username, password: normalizedForm.password,
            });
            if (normalizedForm.rememberCredentials) {
                const isSaved = saveRememberedAdminCredentials(normalizedForm);
                setHasRememberedAdminCredentials(isSaved);
                if (!isSaved) {
                    addToast('浏览器无法保存账号密码，本次已正常登录', 'error');
                }
            } else {
                clearRememberedAdminCredentials();
                setHasRememberedAdminCredentials(false);
            }
            setLoginForm(normalizedForm);
            setSession(result);
            addToast('后台登录成功', 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 退出后台登录。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleLogout() {
        try {
            await logoutAdmin();
            setSession({authenticated: false, username: null});
            addToast('已退出后台', 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 打开新建题库弹窗，并优先填入服务端生成的随机短码。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleCreateBank() {
        const nextForm = createEmptyBankForm();
        try {
            const result = await fetchRandomSlug();
            nextForm.slug = result.slug;
        } catch (error) {
            addToast(error.message, 'error');
        }
        setSelectedBank(null);
        setSelectedBankId(null);
        setBankForm(nextForm);
        setIsBankModalOpen(true);
        navigateTo('/admin/banks');
    }

    /**
     * 打开指定题库编辑弹窗，先读取详情确保不会丢失题目数组。
     *
     * @param {number} bankId 题库 ID。
     * @returns {Promise<void>} 无返回值。
     */
    async function handleEditBank(bankId) {
        try {
            const detail = await fetchAdminQuestionBank(bankId);
            setSelectedBank(detail);
            setSelectedBankId(detail.id);
            setBankForm(bankToForm(detail));
            setIsBankModalOpen(true);
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 保存题库。
     *
     * @param {SubmitEvent} event 表单事件。
     * @returns {Promise<void>} 无返回值。
     */
    async function handleSaveBank(event) {
        event.preventDefault();
        const payload = normalizeBankPayload(bankForm);
        if (!payload.name || !payload.slug) {
            addToast('请填写题库名称和专属链接', 'error');
            return;
        }
        if (payload.items.some((item) => !item.left_text || !item.right_text)) {
            addToast('题目左右两侧内容必须同时填写', 'error');
            return;
        }
        setIsSavingBank(true);
        try {
            const result = selectedBank ? await updateAdminQuestionBank(selectedBank.id, payload) : await createAdminQuestionBank(payload);
            addToast(selectedBank ? '题库已更新' : '题库已创建', 'success');
            setIsBankModalOpen(false);
            await loadAdminOverview(result.id);
        } catch (error) {
            addToast(error.message, 'error');
        } finally {
            setIsSavingBank(false);
        }
    }

    /**
     * 删除当前题库。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleDeleteBank() {
        if (!selectedBank || !window.confirm(`确认删除题库“${selectedBank.name}”？`)) {
            return;
        }
        try {
            await deleteAdminQuestionBank(selectedBank.id);
            setSelectedBank(null);
            setSelectedBankId(null);
            setBankForm(createEmptyBankForm());
            setIsBankModalOpen(false);
            addToast('题库已删除', 'success');
            await loadAdminOverview(null);
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 设置当前题库为主域名默认题库。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleSetDefaultBank() {
        if (!selectedBank) {
            return;
        }
        try {
            const settings = await updateSiteSettings({default_question_bank_id: selectedBank.id});
            setSiteSettings(settings);
            addToast('默认题库已更新', 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 保存排行榜记录。
     *
     * @param {SubmitEvent} event 表单事件。
     * @returns {Promise<void>} 无返回值。
     */
    async function handleSaveRecord(event) {
        event.preventDefault();
        if (!selectedBank) {
            addToast('请先选择题库', 'error');
            return;
        }
        setIsSavingRecord(true);
        try {
            const payload = normalizeRecordPayload(recordForm);
            if (recordForm.id) {
                await updateAdminLeaderboardRecord(recordForm.id, payload);
                addToast('排行榜记录已更新', 'success');
            } else {
                await createAdminLeaderboardRecord(selectedBank.id, payload);
                addToast('排行榜记录已新增', 'success');
            }
            setRecordForm({...DEFAULT_RECORD_FORM});
            setLeaderboardReloadKey((key) => key + 1);
        } catch (error) {
            addToast(error.message, 'error');
        } finally {
            setIsSavingRecord(false);
        }
    }

    /**
     * 删除排行榜记录。
     *
     * @param {number} recordId 记录 ID。
     * @returns {Promise<void>} 无返回值。
     */
    async function handleDeleteRecord(recordId) {
        if (!window.confirm('确认删除这条排行榜记录？')) {
            return;
        }
        try {
            await deleteAdminLeaderboardRecord(recordId);
            setLeaderboardReloadKey((key) => key + 1);
            addToast('排行榜记录已删除', 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 切换题库批量选择状态。
     *
     * @param {number} bankId 题库 ID。
     */
    function toggleBankSelection(bankId) {
        setSelectedBankIds((currentIds) => {
            const nextIds = new Set(currentIds);
            if (nextIds.has(bankId)) {
                nextIds.delete(bankId);
            } else {
                nextIds.add(bankId);
            }
            return nextIds;
        });
    }

    /**
     * 切换当前页所有题库选择状态。
     *
     * @param {boolean} checked 是否全选。
     */
    function toggleAllBankSelection(checked, currentPageBanks = []) {
        const currentPageIds = currentPageBanks.map((bank) => bank.id);
        setSelectedBankIds((currentIds) => {
            const nextIds = new Set(currentIds);
            currentPageIds.forEach((bankId) => {
                if (checked) {
                    nextIds.add(bankId);
                } else {
                    nextIds.delete(bankId);
                }
            });
            return nextIds;
        });
    }

    /**
     * 批量删除已选题库。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleBatchDeleteBanks() {
        const ids = Array.from(selectedBankIds);
        if (ids.length === 0) {
            addToast('请先选择要删除的题库', 'error');
            return;
        }
        if (!window.confirm(`确认删除已选 ${ids.length} 个题库？此操作不可恢复。`)) {
            return;
        }
        try {
            const result = await batchDeleteQuestionBanks(ids);
            if (selectedBank && ids.includes(selectedBank.id)) {
                setSelectedBank(null);
                setSelectedBankId(null);
                setBankForm(createEmptyBankForm());
            }
            setSelectedBankIds(new Set());
            setBanksReloadKey((key) => key + 1);
            addToast(`已删除 ${result.deleted} 个题库`, 'success');
            await loadAdminOverview(null);
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    /**
     * 根据后台子路由渲染独立页面。
     *
     * @returns {JSX.Element} 当前后台页面。
     */
    function renderAdminPage() {
        if (adminRoute.page === 'banks') {
            return (<AdminBanksPage
                addToast={addToast}
                defaultBankId={siteSettings.default_question_bank_id}
                selectedBankIds={selectedBankIds}
                reloadKey={banksReloadKey}
                onBatchDelete={handleBatchDeleteBanks}
                onCreate={handleCreateBank}
                onEdit={handleEditBank}
                onToggleAll={toggleAllBankSelection}
                onToggleBank={toggleBankSelection}
            />);
        }
        if (adminRoute.page === 'questions') {
            return (<section className="admin-panel bank-editor-panel">
                <div className="page-back-row">
                    <button className="secondary-button compact-button" type="button"
                            onClick={() => navigateTo('/admin/banks')}>
                        <ArrowLeft size={15}/>
                        <span>返回题库列表</span>
                    </button>
                </div>
                <AdminBankForm
                    bankForm={bankForm}
                    isSaving={isSavingBank}
                    selectedBank={selectedBank}
                    styles={styles}
                    onChange={setBankForm}
                    onDelete={handleDeleteBank}
                    onSave={handleSaveBank}
                    onSetDefault={handleSetDefaultBank}
                    showBankFields={false}
                    showActions={false}
                    showHeader={false}
                    autoSave={true}
                    saveStatus={autoSaveStatus}
                />
            </section>);
        }
        if (adminRoute.page === 'leaderboard') {
            return (<section className="admin-panel leaderboard-editor-panel">
                <div className="panel-title-row">
                    <button className="secondary-button compact-button" type="button"
                            onClick={() => navigateTo('/admin/banks')}>
                        <ArrowLeft size={15}/>
                        <span>返回题库列表</span>
                    </button>
                </div>
                <AdminLeaderboardManager
                    addToast={addToast}
                    bankId={adminRoute.bankId}
                    form={recordForm}
                    isSaving={isSavingRecord}
                    reloadKey={leaderboardReloadKey}
                    selectedBank={selectedBank}
                    onChange={setRecordForm}
                    onDelete={handleDeleteRecord}
                    onEdit={setRecordForm}
                    onSave={handleSaveRecord}
                />
            </section>);
        }
        if (adminRoute.page === 'logs') {
            return <AdminBankLogsPage addToast={addToast} bank={routeBank} bankId={adminRoute.bankId}
                                      onBack={() => navigateTo('/admin/banks')}/>;
        }
        if (adminRoute.page === 'access-logs') {
            return (<section className="admin-panel access-log-panel">
                <AccessLogPanel addToast={addToast} banks={banks}/>
            </section>);
        }
        return <AdminOverviewPage addToast={addToast} banks={banks}/>;
    }

    if (isSessionLoading) {
        return <LoadingPage text="正在验证后台登录状态..."/>;
    }

    if (!session.authenticated) {
        return (<AdminLoginPage
            adminTheme={adminTheme}
            form={loginForm}
            hasRememberedCredentials={hasRememberedAdminCredentials}
            siteTitle={siteTitle}
            onChange={setLoginForm}
            onClearRemembered={() => {
                clearRememberedAdminCredentials();
                setHasRememberedAdminCredentials(false);
                setLoginForm({...DEFAULT_ADMIN_LOGIN_FORM});
                addToast('已清除本地保存的账号密码', 'success');
            }}
            onLogin={handleLogin}
            onToggleTheme={onToggleTheme}
        />);
    }

    return (<main className="admin-shell">
        <div
            className={`admin-layout ${isSidebarCollapsed ? 'admin-layout-collapsed' : ''} ${isMobileSidebarOpen ? 'admin-mobile-sidebar-open' : ''}`}>
            <aside className="admin-sidebar">
                <div className="admin-sidebar-brand">
                    <span className="admin-product-mark"><LayoutDashboard size={18}/></span>
                    <div className="admin-sidebar-title">
                        <strong>{siteTitle}</strong>
                    </div>
                </div>
                <nav className="admin-side-nav" aria-label="后台模块">
                    {ADMIN_NAV_ITEMS.map(({path, label, Icon, end}) => (<NavLink
                        className={({isActive}) => `admin-nav-link ${isActive ? 'active' : ''}`}
                        end={end}
                        key={path}
                        title={label}
                        to={path}
                        onClick={() => setIsMobileSidebarOpen(false)}
                    >
                        {createElement(Icon, {size: 16})}
                        <span>{label}</span>
                    </NavLink>))}
                </nav>
            </aside>

            <section className="admin-workspace">
                <header className="admin-topbar">
                    <button
                        className="sidebar-collapse-button topbar-sidebar-toggle"
                        type="button"
                        aria-label={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
                        title={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
                        onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
                    >
                        {isSidebarCollapsed ? <Menu size={18}/> : <ChevronLeft size={18}/>}
                    </button>
                    <button
                        className="mobile-menu-button"
                        type="button"
                        aria-label={isMobileSidebarOpen ? '关闭导航菜单' : '打开导航菜单'}
                        aria-expanded={isMobileSidebarOpen}
                        onClick={() => setIsMobileSidebarOpen((isOpen) => !isOpen)}
                    >
                        {isMobileSidebarOpen ? <X size={18}/> : <Menu size={18}/>}
                    </button>
                    <div className="admin-topbar-copy">
                        <h1>{adminPageTitle}</h1>
                    </div>
                    <div className="admin-topbar-actions">
                        <AdminThemeToggle adminTheme={adminTheme} onToggleTheme={onToggleTheme}/>
                        <button className="theme-toggle-button" type="button"
                                aria-label={`退出当前用户 ${session.username}`} title="退出登录" onClick={handleLogout}>
                            <LogOut size={15}/>
                        </button>
                    </div>
                </header>

                <section className="admin-content-grid">{renderAdminPage()}</section>
            </section>
        </div>
        {isMobileSidebarOpen && <button className="admin-sidebar-overlay" type="button" aria-label="关闭导航菜单"
                                        onClick={() => setIsMobileSidebarOpen(false)}/>}
        {isBankModalOpen && <div className="admin-modal-backdrop" role="presentation">
            <section className="admin-modal" role="dialog" aria-modal="true"
                     aria-label={selectedBank ? '编辑题库' : '新建题库'}>
                <button className="modal-close-button" type="button" onClick={() => setIsBankModalOpen(false)}
                        aria-label="关闭">
                    <X size={18}/>
                </button>
                <AdminBankForm
                    bankForm={bankForm}
                    isSaving={isSavingBank}
                    selectedBank={selectedBank}
                    styles={styles}
                    onChange={setBankForm}
                    onDelete={handleDeleteBank}
                    onSave={handleSaveBank}
                    onSetDefault={handleSetDefaultBank}
                    showItemEditor={false}
                />
            </section>
        </div>}
    </main>);
}

/**
 * 后台指标卡片。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 指标卡片。
 */
function AdminMetricCard({Icon, label, value, detail}) {
    return (<article className="admin-metric-card">
        <span className="admin-metric-icon">{createElement(Icon, {size: 18})}</span>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
    </article>);
}

/**
 * 后台概览页，展示核心指标和近 7 天提交趋势。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 概览页面。
 */
function AdminOverviewPage({addToast, banks}) {
    const [overview, setOverview] = useState({
        bank_count: 0, active_bank_count: 0, total_question_count: 0, submission_count_7d: 0,
    });
    const [trend, setTrend] = useState({dates: [], series: []});
    const [selectedBankId, setSelectedBankId] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isActive = true;

        async function loadOverview() {
            setIsLoading(true);
            try {
                const [stats, trendData] = await Promise.all([fetchAdminOverview(), fetchSubmissionTrend(selectedBankId ? Number(selectedBankId) : null),]);
                if (!isActive) {
                    return;
                }
                setOverview(stats);
                setTrend(trendData);
            } catch (error) {
                addToast(error.message, 'error');
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        loadOverview();
        return () => {
            isActive = false;
        };
    }, [addToast, selectedBankId]);

    const trendOption = useMemo(() => ({
        tooltip: {trigger: 'axis'},
        legend: {type: 'scroll', bottom: 0},
        grid: {top: 24, right: 24, bottom: 58, left: 42},
        xAxis: {type: 'category', data: trend.dates},
        yAxis: {type: 'value', minInterval: 1},
        series: trend.series.map((seriesItem) => ({
            name: seriesItem.bank_name, type: 'bar', data: seriesItem.data, barMaxWidth: 28,
        })),
    }), [trend]);

    return (<>
        <section className="admin-metric-grid" aria-label="后台概览">
            <AdminMetricCard Icon={Database} label="题库总数" value={overview.bank_count} detail="全部题库数量"/>
            <AdminMetricCard Icon={ShieldCheck} label="题库启用数量" value={overview.active_bank_count}
                             detail="当前可访问题库"/>
            <AdminMetricCard Icon={BookOpen} label="题目总数" value={overview.total_question_count}
                             detail="所有题库题目对"/>
            <AdminMetricCard Icon={BarChart3} label="7 天提交数" value={overview.submission_count_7d}
                             detail="近 7 天提交流水"/>
        </section>
        <section className="admin-panel admin-chart-panel">
            <div className="panel-title-row">
                <div>
                    <h2>7 天内每题库提交数量趋势</h2>
                    <p className="panel-note">按提交时间聚合，支持按题库筛选。</p>
                </div>
                <label className="admin-inline-select">
                    <select value={selectedBankId} onChange={(event) => setSelectedBankId(event.target.value)}>
                        <option value="">全部题库</option>
                        {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
                    </select>
                </label>
            </div>
            {isLoading ? <div className="empty-state">正在加载趋势数据...</div> : <div className="admin-chart-wrap">
                {trend.series.length === 0 ? <p className="empty-state">暂无提交趋势数据。</p> :
                    <ReactECharts option={trendOption} style={{height: 340}}/>}
            </div>}
        </section>
    </>);
}

/**
 * 通用分页控件，提供页码导航和每页条数选择。
 *
 * @param {object} props 组件属性。
 * @param {number} props.total 记录总数。
 * @param {number} props.page 当前页码（从1开始）。
 * @param {number} props.pageSize 每页条数。
 * @param {(page: number) => void} props.onPageChange 页码变化回调。
 * @param {(size: number) => void} props.onPageSizeChange 每页条数变化回调。
 * @returns {JSX.Element} 分页控件。
 */
function AdminPagination({total, page, pageSize, onPageChange, onPageSizeChange}) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const canPrev = page > 1;
    const canNext = page < totalPages;
    return (<div className="admin-pagination">
        <div className="admin-pagination-info">
            共 {total} 条，第 {page}/{totalPages} 页
        </div>
        <div className="admin-pagination-controls">
            <label className="admin-page-size-label">
                <select className="admin-page-size-select" value={pageSize}
                        onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                    {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
                条
            </label>
            <button type="button" className="admin-pagination-btn" disabled={!canPrev}
                    onClick={() => onPageChange(page - 1)} aria-label="上一页">
                <ChevronLeft size={16}/>
            </button>
            <button type="button" className="admin-pagination-btn" disabled={!canNext}
                    onClick={() => onPageChange(page + 1)} aria-label="下一页">
                <ChevronRight size={16}/>
            </button>
        </div>
    </div>);
}

/**
 * 通用搜索工具栏，提供文本搜索框（带防抖）和可选下拉筛选器。
 *
 * @param {object} props 组件属性。
 * @param {string} props.searchValue 当前搜索文本。
 * @param {(value: string) => void} props.onSearchChange 搜索文本变化回调。
 * @param {string} props.placeholder 搜索框占位提示。
 * @param {Array<{label: string, value: string, options: Array<{label: string, value: string}>}>} [props.filters] 可选下拉筛选器配置。
 * @param {object} props.filterValues 当前筛选器取值键值对。
 * @param {(key: string, value: string) => void} props.onFilterChange 筛选器变化回调。
 * @returns {JSX.Element} 搜索工具栏。
 */
function AdminSearchBar({searchValue, onSearchChange, placeholder, filters, filterValues, onFilterChange}) {
    return (<div className="admin-search-bar">
        <div className="admin-search-input-wrapper">
            <Search size={16} className="admin-search-icon"/>
            <input type="text" className="admin-search-input" placeholder={placeholder} value={searchValue}
                   onChange={(event) => onSearchChange(event.target.value)}/>
        </div>
        {filters && filters.length > 0 && filters.map((filter) => <select key={filter.value}
                                                                          className="admin-filter-select"
                                                                          value={filterValues[filter.value] ?? ''}
                                                                          onChange={(event) => onFilterChange(filter.value, event.target.value)}>
            <option value="">{filter.label}</option>
            {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>)}
    </div>);
}

/**
 * 题库列表页，自包含分页/搜索，提供批量删除和行内四个操作入口。
 *
 * @param {object} props 组件属性。
 * @param {(msg: string, type: string) => void} props.addToast 全局 toast 回调。
 * @param {number | null} props.defaultBankId 默认题库 ID。
 * @param {number} props.reloadKey 外部触发刷新的递增计数器。
 * @param {Set<number>} props.selectedBankIds 已选中的题库 ID 集合。
 * @param {() => void} props.onBatchDelete 批量删除回调。
 * @param {() => void} props.onCreate 新建模库回调。
 * @param {(bankId: number) => void} props.onEdit 编辑题库回调。
 * @param {(checked: boolean, entries: Array<object>) => void} props.onToggleAll 全选/取消全选回调。
 * @param {(bankId: number) => void} props.onToggleBank 切换单个题库选中状态。
 * @returns {JSX.Element} 题库管理页。
 */
function AdminBanksPage({
                            addToast,
                            defaultBankId,
                            reloadKey,
                            selectedBankIds,
                            onBatchDelete,
                            onCreate,
                            onEdit,
                            onToggleAll,
                            onToggleBank
                        }) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [isActiveFilter, setIsActiveFilter] = useState('');
    const [banks, setBanks] = useState([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        let isActive = true;

        async function loadBanks() {
            setIsLoading(true);
            try {
                const result = await fetchAdminQuestionBanks({
                    limit: pageSize,
                    offset: (page - 1) * pageSize,
                    search: search || undefined,
                    isActive: isActiveFilter === '' ? undefined : isActiveFilter === 'true',
                });
                if (isActive) {
                    setBanks(result.entries);
                    setTotal(result.total);
                }
            } catch (error) {
                if (isActive) {
                    addToast(error.message, 'error');
                }
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        loadBanks();
        return () => {
            isActive = false;
        };
    }, [addToast, page, pageSize, search, isActiveFilter, reloadKey]);

    const handleSearchChange = useCallback((value) => {
        setSearchInput(value);
        setPage(1);
    }, []);
    const handleFilterChange = useCallback((_key, value) => {
        setIsActiveFilter(value);
        setPage(1);
    }, []);
    const handlePageSizeChange = useCallback((size) => {
        setPageSize(size);
        setPage(1);
    }, []);

    const isAllSelected = banks.length > 0 && banks.every((bank) => selectedBankIds.has(bank.id));
    const bankFilters = [{
        label: '全部状态', value: 'isActive', options: [{label: '启用', value: 'true'}, {label: '停用', value: 'false'}]
    },];

    return (<section className="admin-panel admin-banks-panel">
        <div className="panel-title-row">
            <div>
                <p className="eyebrow">题库管理</p>
                <h2>题库列表</h2>
            </div>
            <div className="table-toolbar">
                <button className="secondary-button compact-button" type="button" onClick={onBatchDelete}
                        disabled={selectedBankIds.size === 0}>
                    <Trash2 size={15}/>
                    <span>批量删除 {selectedBankIds.size > 0 ? `(${selectedBankIds.size})` : ''}</span>
                </button>
                <button className="primary-button compact-button" type="button" onClick={onCreate}>
                    <Plus size={15}/>
                    <span>新建题库</span>
                </button>
            </div>
        </div>
        <AdminSearchBar
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            placeholder="搜索题库名称或链接…"
            filters={bankFilters}
            filterValues={{isActive: isActiveFilter}}
            onFilterChange={handleFilterChange}
        />
        <div className="admin-data-table" role="table" aria-label="题库列表">
            <div className="admin-data-row admin-data-head" role="row">
                <span role="columnheader"><input checked={isAllSelected} type="checkbox"
                                                 onChange={(event) => onToggleAll(event.target.checked, banks)}/></span>
                <span role="columnheader">题库</span>
                <span role="columnheader">链接</span>
                <span role="columnheader">状态</span>
                <span role="columnheader">题目</span>
                <span role="columnheader">Top</span>
                <span role="columnheader">操作</span>
            </div>
            {isLoading ? <p className="empty-state data-table-empty">正在加载题库列表…</p> : banks.length === 0 ?
                <p className="empty-state data-table-empty">暂无题库，请先新建题库。</p> : banks.map((bank) => (
                    <div className="admin-data-row" key={bank.id} role="row">
                        <span role="cell"><input checked={selectedBankIds.has(bank.id)} type="checkbox"
                                                 onChange={() => onToggleBank(bank.id)}/></span>
                        <strong role="cell">{bank.name}{defaultBankId === bank.id &&
                            <small className="default-bank-tag">默认</small>}</strong>
                        <span role="cell"><code>/b/{bank.slug}</code></span>
                        <span role="cell"><span
                            className={`status-pill ${bank.is_active ? 'active' : ''}`}>{bank.is_active ? '启用' : '停用'}</span></span>
                        <span role="cell">{bank.item_count}</span>
                        <span role="cell">{bank.leaderboard_limit}</span>
                        <span className="table-actions" role="cell">
                    <Link className="ghost-button compact-button" to={`/admin/banks/${bank.id}/questions`}><BookOpen
                        size={14}/><span>题目</span></Link>
                    <Link className="ghost-button compact-button" to={`/admin/banks/${bank.id}/leaderboard`}><Trophy
                        size={14}/><span>排行榜</span></Link>
                    <button className="ghost-button compact-button" type="button"
                            onClick={() => onEdit(bank.id)}><Pencil size={14}/><span>编辑</span></button>
                    <Link className="ghost-button compact-button" to={`/admin/banks/${bank.id}/logs`}><Activity
                        size={14}/><span>日志</span></Link>
                </span>
                    </div>))}
        </div>
        {!isLoading && total > 0 && <AdminPagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
        />}
    </section>);
}

/**
 * 题库日志页，包含提交流水和访问日志两个标签页。数据获取委托给子组件自管理。
 *
 * @param {object} props 组件属性。
 * @param {string} props.bank 题库对象（用于标题显示）。
 * @param {number | null} props.bankId 题库 ID。
 * @param {() => void} props.onBack 返回回调。
 * @returns {JSX.Element} 题库日志页。
 */
function AdminBankLogsPage({addToast, bank, bankId, onBack}) {
    const [activeTab, setActiveTab] = useState('submissions');

    return (<section className="admin-panel bank-logs-panel">
        <div className="panel-title-row">
            <div>
                <p className="eyebrow">题库日志</p>
                <h2>{bank ? bank.name : '题库日志'}</h2>
                <p className="panel-note">查看该题库的提交流水与访问明细，支持分页和搜索。</p>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={onBack}>
                <ArrowLeft size={15}/>
                <span>返回题库列表</span>
            </button>
        </div>
        <div className="admin-tabs" role="tablist" aria-label="题库日志类型">
            <button className={activeTab === 'submissions' ? 'active' : ''} type="button"
                    onClick={() => setActiveTab('submissions')}>提交统计
            </button>
            <button className={activeTab === 'access' ? 'active' : ''} type="button"
                    onClick={() => setActiveTab('access')}>访问日志
            </button>
        </div>
        {activeTab === 'access' ? <AccessLogPanel addToast={addToast} bankId={bankId}/> :
            <SubmissionLogPanel addToast={addToast} bankId={bankId}/>}
    </section>);
}

/**
 * 提交流水列表，自包含分页/搜索。
 *
 * @param {object} props 组件属性。
 * @param {(msg: string, type: string) => void} props.addToast 全局 toast 回调。
 * @param {number | null} props.bankId 题库 ID。
 * @returns {JSX.Element} 提交流水面板。
 */
function SubmissionLogPanel({addToast, bankId}) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [entries, setEntries] = useState([]);
    const [selectedLogIds, setSelectedLogIds] = useState(() => new Set());
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        if (!bankId) {
            return;
        }
        let isActive = true;

        async function loadLogs() {
            setIsLoading(true);
            try {
                const result = await fetchBankSubmissionLogs(bankId, {
                    limit: pageSize, offset: (page - 1) * pageSize, search: search || undefined,
                });
                if (isActive) {
                    const nextEntries = result.entries;
                    const currentEntryIds = new Set(nextEntries.map((entry) => entry.id));
                    setEntries(nextEntries);
                    setTotal(result.total);
                    setSelectedLogIds((currentIds) => new Set([...currentIds].filter((logId) => currentEntryIds.has(logId))));
                }
            } catch (error) {
                if (isActive) {
                    addToast(error.message, 'error');
                }
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        loadLogs();
        return () => {
            isActive = false;
        };
    }, [addToast, bankId, page, pageSize, search, reloadKey]);

    const handleSearchChange = useCallback((value) => {
        setSearchInput(value);
        setPage(1);
    }, []);
    const handlePageSizeChange = useCallback((size) => {
        setPageSize(size);
        setPage(1);
    }, []);
    const isAllSelected = areAllEntriesSelected(entries, selectedLogIds);

    /**
     * 批量删除已选提交流水。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleBatchDeleteLogs() {
        const ids = Array.from(selectedLogIds);
        if (!bankId) {
            addToast('请先选择题库', 'error');
            return;
        }
        if (ids.length === 0) {
            addToast('请先选择要删除的提交流水', 'error');
            return;
        }
        if (!window.confirm(`确认删除已选 ${ids.length} 条提交流水？`)) {
            return;
        }
        try {
            const result = await batchDeleteSubmissionLogs(bankId, ids);
            setSelectedLogIds(new Set());
            setReloadKey((key) => key + 1);
            addToast(`已删除 ${result.deleted} 条提交流水`, 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    return (<div>
        <div className="table-toolbar log-toolbar">
            <button
                className="danger-button compact-button"
                type="button"
                disabled={selectedLogIds.size === 0}
                onClick={handleBatchDeleteLogs}
            >
                <Trash2 size={15}/>
                <span>批量删除 {selectedLogIds.size > 0 ? `(${selectedLogIds.size})` : ''}</span>
            </button>
        </div>
        <AdminSearchBar
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            placeholder="搜索学生姓名或学号…"
        />
        <div className="admin-data-table submission-log-table" role="table" aria-label="提交流水">
            <div className="admin-data-row admin-data-head" role="row">
                <span role="columnheader"><input checked={isAllSelected} type="checkbox"
                                                 onChange={(event) => setSelectedLogIds(event.target.checked ? new Set(entries.map((entry) => entry.id)) : new Set())}/></span>
                <span role="columnheader">学生</span>
                <span role="columnheader">成绩</span>
                <span role="columnheader">用时</span>
                <span role="columnheader">来源</span>
                <span role="columnheader">提交时间</span>
            </div>
            {isLoading ? <p className="empty-state data-table-empty">正在加载提交流水…</p> : entries.length === 0 ?
                <p className="empty-state data-table-empty">暂无提交流水。</p> : entries.map((entry) => (
                    <div className="admin-data-row" key={entry.id} role="row">
                        <span role="cell"><input checked={selectedLogIds.has(entry.id)} type="checkbox"
                                                 aria-label={`选择 ${entry.student_name} 的提交流水`}
                                                 onChange={() => setSelectedLogIds((currentIds) => toggleSelectionId(currentIds, entry.id))}/></span>
                        <strong
                            role="cell">{entry.student_class} · {entry.student_name}<small>{entry.student_id}</small></strong>
                        <span role="cell">{entry.correct_count}/{entry.total_pairs} · {entry.score} 分</span>
                        <span role="cell">{formatElapsedTime(entry.elapsed_seconds)}</span>
                        <span role="cell">{entry.is_manual ? '后台录入' : '学生提交'}</span>
                        <span role="cell">{formatSubmittedTime(entry.submitted_at)}</span>
                    </div>))}
        </div>
        {!isLoading && total > 0 && <AdminPagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
        />}
    </div>);
}

/**
 * 后台深浅色主题切换按钮。
 *
 * @param {object} props 组件属性。
 * @param {'light' | 'dark'} props.adminTheme 当前后台主题。
 * @param {() => void} props.onToggleTheme 切换主题回调。
 * @returns {JSX.Element} 主题切换按钮。
 */
function AdminThemeToggle({adminTheme, onToggleTheme}) {
    const isDark = adminTheme === ADMIN_THEME_DARK;
    return (<button
        className="theme-toggle-button"
        type="button"
        title={isDark ? '切换浅色模式' : '切换深色模式'}
        aria-label={isDark ? '切换浅色模式' : '切换深色模式'}
        onClick={onToggleTheme}
    >
        {isDark ? <Sun size={16}/> : <Moon size={16}/>}
    </button>);
}

/**
 * 后台登录页。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 登录页。
 */
function AdminLoginPage({
                            adminTheme,
                            form,
                            hasRememberedCredentials,
                            siteTitle,
                            onChange,
                            onLogin,
                            onClearRemembered,
                            onToggleTheme
                        }) {
    return (<main className="admin-login-shell">
        <AdminThemeToggle adminTheme={adminTheme} onToggleTheme={onToggleTheme}/>
        <section className="admin-login-panel">
            <form className="admin-login-form" onSubmit={onLogin}>
                <div className="login-form-title">
                    <span className="login-title-icon"><ShieldCheck size={18}/></span>
                    <p className="eyebrow">管理员认证</p>
                    <h2>{siteTitle}</h2>
                    {/*<p>账号密码由服务端环境变量配置。</p>*/}
                </div>
                <label>
                    <span>账号</span>
                    <span className="admin-input-shell">
                        <UserRound size={16}/>
                        <input
                            autoFocus
                            autoComplete="username"
                            maxLength={ADMIN_USERNAME_LIMIT}
                            value={form.username}
                            onChange={(event) => onChange({...form, username: event.target.value})}
                        />
                    </span>
                </label>
                <label>
                    <span>密码</span>
                    <span className="admin-input-shell">
                        <LockKeyhole size={16}/>
                        <input
                            autoComplete="current-password"
                            maxLength={ADMIN_PASSWORD_LIMIT}
                            type="password"
                            value={form.password}
                            onChange={(event) => onChange({...form, password: event.target.value})}
                        />
                    </span>
                </label>
                <label className="admin-remember-row">
                    <input
                        checked={form.rememberCredentials}
                        type="checkbox"
                        onChange={(event) => onChange({...form, rememberCredentials: event.target.checked})}
                    />
                    <span>记住账号和密码</span>
                </label>
                <button className="primary-button" type="submit">
                    <LogIn size={16}/>
                    <span>登录</span>
                </button>
                <div className="login-secondary-actions">
                    {hasRememberedCredentials && <button
                        className="ghost-button"
                        type="button"
                        onClick={onClearRemembered}
                    >
                        <Trash2 size={15}/>
                        <span>清除已保存</span>
                    </button>}
                </div>
            </form>
        </section>
    </main>);
}

/**
 * 后台题库表单。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 题库表单。
 */
function AdminBankForm({
                           bankForm,
                           styles,
                           selectedBank,
                           isSaving,
                           onChange,
                           onSave,
                           onDelete,
                           onSetDefault,
                           showBankFields = true,
                           showItemEditor = true,
                           showActions = true,
                           showHeader = true,
                           autoSave = false,
                           saveStatus = AUTO_SAVE_STATUS_IDLE,
                       }) {
    const [selectedItemIndexes, setSelectedItemIndexes] = useState(() => new Set());

    /**
     * 更新题库基础字段。
     *
     * @param {string} fieldName 字段名。
     * @param {string | boolean | number} value 字段值。
     */
    function updateField(fieldName, value) {
        onChange({...bankForm, [fieldName]: value});
    }

    /**
     * 更新题目行。
     *
     * @param {number} index 题目索引。
     * @param {string} fieldName 字段名。
     * @param {string} value 字段值。
     */
    function updateItem(index, fieldName, value) {
        const nextItems = bankForm.items.map((item, itemIndex) => (itemIndex === index ? {
            ...item, [fieldName]: value
        } : item));
        onChange({...bankForm, items: nextItems});
    }

    /**
     * 切换题目行选择状态。
     *
     * @param {number} index 题目行索引。
     */
    function toggleItemSelection(index) {
        setSelectedItemIndexes((currentIndexes) => toggleSelectionId(currentIndexes, index));
    }

    /**
     * 批量删除已选题目行。
     */
    function deleteSelectedItems() {
        const validSelectedIndexes = new Set([...selectedItemIndexes].filter((index) => index < bankForm.items.length));
        if (validSelectedIndexes.size === 0) {
            return;
        }
        if (!window.confirm(`确认删除已选 ${validSelectedIndexes.size} 道题目？`)) {
            return;
        }
        const nextItems = bankForm.items.filter((_, index) => !validSelectedIndexes.has(index));
        setSelectedItemIndexes(new Set());
        onChange({...bankForm, items: nextItems});
    }

    const validSelectedItemIndexes = new Set([...selectedItemIndexes].filter((index) => index < bankForm.items.length));
    const selectedItemCount = validSelectedItemIndexes.size;
    const areAllItemsSelected = bankForm.items.length > 0 && bankForm.items.every((_, index) => validSelectedItemIndexes.has(index));

    return (<form className="admin-form" onSubmit={onSave}>
        {showHeader && <div className="panel-title-row">
            <div>
                <h2>{selectedBank ? '编辑题库' : '新建题库'}</h2>
                {selectedBank && <p className="panel-note">专属链接：/b/{selectedBank.slug}</p>}
            </div>
            {autoSave && <span className={`auto-save-status auto-save-${saveStatus}`}>
                {saveStatus === AUTO_SAVE_STATUS_SAVING && '保存中...'}
                {saveStatus === AUTO_SAVE_STATUS_SAVED && '已自动保存'}
                {saveStatus === AUTO_SAVE_STATUS_ERROR && '保存失败'}
            </span>}
        </div>}

        {showBankFields && <div className="admin-form-grid">
            <label>
                <span>名称</span>
                <input value={bankForm.name} onChange={(event) => updateField('name', event.target.value)}/>
            </label>
            <label>
                <span>专属链接</span>
                <input value={bankForm.slug} onChange={(event) => updateField('slug', event.target.value)}/>
            </label>
            <label>
                <span>排行榜显示</span>
                <input
                    min="1"
                    max="100"
                    type="number"
                    value={bankForm.leaderboard_limit}
                    onChange={(event) => updateField('leaderboard_limit', event.target.value)}
                />
            </label>
            <label>
                <span>页面样式</span>
                <select
                    value={bankForm.submission_style}
                    onChange={(event) => updateField('submission_style', event.target.value)}
                >
                    {(styles.length > 0 ? styles : [{key: 'classic', name: '青绿考试'}]).map((style) => (
                        <option key={style.key} value={style.key}>{style.name}</option>))}
                </select>
            </label>
            <label className="admin-form-wide">
                <span>说明</span>
                <textarea
                    value={bankForm.description}
                    rows="3"
                    onChange={(event) => updateField('description', event.target.value)}
                />
            </label>
            <label className="admin-form-wide">
                <span>公告</span>
                <textarea
                    value={bankForm.announcement}
                    rows="3"
                    placeholder="用于向访问者展示临时说明，可留空"
                    onChange={(event) => updateField('announcement', event.target.value)}
                />
            </label>
            <label className="switch-row admin-form-wide">
                <input
                    checked={bankForm.is_active}
                    type="checkbox"
                    onChange={(event) => updateField('is_active', event.target.checked)}
                />
                <span>启用公开访问</span>
            </label>
        </div>}

        {showItemEditor && <div className="item-editor">
            <div className="panel-title-row">
                <h3>配对题目</h3>
                <div className="table-toolbar">
                    <button
                        className="danger-button compact-button"
                        type="button"
                        disabled={selectedItemCount === 0}
                        onClick={deleteSelectedItems}
                    >
                        <Trash2 size={15}/>
                        <span>批量删除 {selectedItemCount > 0 ? `(${selectedItemCount})` : ''}</span>
                    </button>
                    <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => onChange({
                            ...bankForm, items: [...bankForm.items, {left_text: '', right_text: ''}]
                        })}
                    >
                        <Plus size={15}/>
                        <span>添加题目</span>
                    </button>
                </div>
            </div>
            <div className="item-row-list">
                {bankForm.items.length > 0 && <label className="bulk-check-row">
                    <input
                        checked={areAllItemsSelected}
                        type="checkbox"
                        onChange={(event) => setSelectedItemIndexes(event.target.checked ? new Set(bankForm.items.map((_, index) => index)) : new Set())}
                    />
                    <span>选择当前全部题目</span>
                </label>}
                {bankForm.items.map((item, index) => (<div className="item-row" key={`item-${index}`}>
                    <input
                        checked={validSelectedItemIndexes.has(index)}
                        type="checkbox"
                        aria-label={`选择第 ${index + 1} 道题目`}
                        onChange={() => toggleItemSelection(index)}
                    />
                    <input
                        value={item.left_text}
                        onChange={(event) => updateItem(index, 'left_text', event.target.value)}
                        placeholder="左侧内容"
                    />
                    <input
                        value={item.right_text}
                        onChange={(event) => updateItem(index, 'right_text', event.target.value)}
                        placeholder="右侧内容"
                    />
                    <button
                        className="ghost-button"
                        type="button"
                        onClick={() => {
                            setSelectedItemIndexes(new Set());
                            onChange({
                                ...bankForm, items: bankForm.items.filter((_, itemIndex) => itemIndex !== index),
                            });
                        }}
                    >
                        <Trash2 size={14}/>
                        <span>删除</span>
                    </button>
                </div>))}
            </div>
        </div>}

        {showActions && <div className="action-row admin-action-row">
            {selectedBank && <button className="secondary-button" type="button" onClick={onSetDefault}>
                <Star size={15}/>
                <span>设为默认</span>
            </button>}
            {selectedBank && <button className="danger-button" type="button" onClick={onDelete}>
                <Trash2 size={15}/>
                <span>删除题库</span>
            </button>}
            <button className="primary-button" type="submit"
                    disabled={isSaving}>
                <Save size={15}/>
                <span>{isSaving ? '正在保存...' : '保存题库'}</span>
            </button>
        </div>}
    </form>);
}

/**
 * 后台排行榜管理，自包含分页/搜索。CRUD 操作后通过 reloadKey 触发数据刷新。
 *
 * @param {object} props 组件属性。
 * @param {(msg: string, type: string) => void} props.addToast 全局 toast 回调。
 * @param {number | null} props.bankId 当前题库 ID。
 * @param {object} props.form 排行榜录入表单状态。
 * @param {boolean} props.isSaving 是否正在保存。
 * @param {number} props.reloadKey 外部触发刷新的递增计数器。
 * @param {object | null} props.selectedBank 当前题库对象。
 * @param {(form: object) => void} props.onChange 表单变化回调。
 * @param {(recordId: number) => void} props.onDelete 删除记录回调。
 * @param {(form: object) => void} props.onEdit 编辑记录回调（设置表单为已有值）。
 * @param {(event: SubmitEvent) => void} props.onSave 保存记录回调。
 * @returns {JSX.Element} 排行榜管理。
 */
function AdminLeaderboardManager({
                                     addToast,
                                     bankId,
                                     form,
                                     isSaving,
                                     reloadKey,
                                     selectedBank,
                                     onChange,
                                     onSave,
                                     onEdit,
                                     onDelete
                                 }) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [entries, setEntries] = useState([]);
    const [selectedRecordIds, setSelectedRecordIds] = useState(() => new Set());
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [localReloadKey, setLocalReloadKey] = useState(0);

    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        if (!bankId) {
            return;
        }
        let isActive = true;

        async function loadLeaderboard() {
            setIsLoading(true);
            try {
                const result = await fetchAdminLeaderboard(bankId, {
                    limit: pageSize, offset: (page - 1) * pageSize, search: search || undefined,
                });
                if (isActive) {
                    const nextEntries = result.entries;
                    const currentEntryIds = new Set(nextEntries.map((entry) => entry.id));
                    setEntries(nextEntries);
                    setTotal(result.total);
                    setSelectedRecordIds((currentIds) => new Set([...currentIds].filter((recordId) => currentEntryIds.has(recordId))));
                }
            } catch (error) {
                if (isActive) {
                    addToast(error.message, 'error');
                }
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        loadLeaderboard();
        return () => {
            isActive = false;
        };
    }, [addToast, bankId, page, pageSize, search, reloadKey, localReloadKey]);

    const handleSearchChange = useCallback((value) => {
        setSearchInput(value);
        setPage(1);
    }, []);
    const handlePageSizeChange = useCallback((size) => {
        setPageSize(size);
        setPage(1);
    }, []);
    const isAllSelected = areAllEntriesSelected(entries, selectedRecordIds);

    /**
     * 批量删除已选排行榜记录。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleBatchDeleteRecords() {
        const ids = Array.from(selectedRecordIds);
        if (ids.length === 0) {
            addToast('请先选择要删除的排行榜记录', 'error');
            return;
        }
        if (!window.confirm(`确认删除已选 ${ids.length} 条排行榜记录？`)) {
            return;
        }
        try {
            const result = await batchDeleteLeaderboardRecords(ids);
            if (form.id && ids.includes(form.id)) {
                onChange({...DEFAULT_RECORD_FORM});
            }
            setSelectedRecordIds(new Set());
            setLocalReloadKey((key) => key + 1);
            addToast(`已删除 ${result.deleted} 条排行榜记录`, 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    return (<div className="leaderboard-manager">
        <div className="panel-title-row">
            <div>
                <h2>排行榜</h2>
                <p className="panel-note">{selectedBank ? selectedBank.name : '请选择题库'}</p>
            </div>
            <div className="table-toolbar">
                <button
                    className="danger-button compact-button"
                    type="button"
                    disabled={selectedRecordIds.size === 0}
                    onClick={handleBatchDeleteRecords}
                >
                    <Trash2 size={15}/>
                    <span>批量删除 {selectedRecordIds.size > 0 ? `(${selectedRecordIds.size})` : ''}</span>
                </button>
                <button className="secondary-button compact-button" type="button"
                        onClick={() => onChange({...DEFAULT_RECORD_FORM})}>
                    <RotateCcw size={15}/>
                    <span>清空</span>
                </button>
            </div>
        </div>
        <form className="record-form" onSubmit={onSave}>
            <label>
                <span>班级</span>
                <input
                    value={form.student_class}
                    onChange={(event) => onChange({...form, student_class: event.target.value})}
                    placeholder="班级"
                />
            </label>
            <label>
                <span>学号</span>
                <input
                    value={form.student_id}
                    inputMode="numeric"
                    maxLength={STUDENT_ID_LENGTH}
                    onChange={(event) => onChange({...form, student_id: event.target.value})}
                    placeholder="9 位数字"
                />
            </label>
            <label>
                <span>姓名</span>
                <input
                    value={form.student_name}
                    onChange={(event) => onChange({...form, student_name: event.target.value})}
                    placeholder="姓名"
                />
            </label>
            <label>
                <span>正确数</span>
                <input
                    min="0"
                    type="number"
                    value={form.correct_count}
                    onChange={(event) => onChange({...form, correct_count: event.target.value})}
                    placeholder="正确数"
                />
            </label>
            <label>
                <span>用时</span>
                <input
                    min="0"
                    type="number"
                    value={form.elapsed_seconds}
                    onChange={(event) => onChange({...form, elapsed_seconds: event.target.value})}
                    placeholder="秒"
                />
            </label>
            <label>
                <span>分数</span>
                <input
                    min="0"
                    max="100"
                    type="number"
                    value={form.score}
                    onChange={(event) => onChange({...form, score: event.target.value})}
                    placeholder="分数"
                />
            </label>
            <button className="primary-button" type="submit" disabled={!selectedBank || isSaving}>
                {form.id ? <Save size={15}/> : <Plus size={15}/>}
                <span>{form.id ? '更新记录' : '新增记录'}</span>
            </button>
        </form>
        <AdminSearchBar
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            placeholder="搜索学生姓名或学号…"
        />
        <div className="admin-table">
            <div className="admin-table-row admin-table-head">
                <span><input checked={isAllSelected} type="checkbox"
                             onChange={(event) => setSelectedRecordIds(event.target.checked ? new Set(entries.map((entry) => entry.id)) : new Set())}/></span>
                <span>排名</span>
                <span>学生</span>
                <span>分数</span>
                <span>用时</span>
                <span>操作</span>
            </div>
            {!bankId ? <p className="empty-state">请先选择题库。</p> : isLoading ?
                <p className="empty-state">正在加载排行榜…</p> : entries.length === 0 ?
                    <p className="empty-state">暂无排行榜记录。</p> : entries.map((entry) => (
                        <div className="admin-table-row" key={entry.id}>
                            <span><input checked={selectedRecordIds.has(entry.id)} type="checkbox"
                                         aria-label={`选择 ${entry.student_name} 的排行榜记录`}
                                         onChange={() => setSelectedRecordIds((currentIds) => toggleSelectionId(currentIds, entry.id))}/></span>
                            <span>{entry.rank}</span>
                            <strong>{entry.student_name} · {entry.student_class}</strong>
                            <span>{entry.score} 分</span>
                            <span>{formatElapsedTime(entry.elapsed_seconds)}</span>
                            <span className="table-actions">
                        <button
                            className="ghost-button"
                            type="button"
                            onClick={() => onEdit({
                                id: entry.id,
                                student_class: entry.student_class,
                                student_id: entry.student_id,
                                student_name: entry.student_name,
                                correct_count: entry.correct_count,
                                elapsed_seconds: entry.elapsed_seconds,
                                score: entry.score,
                            })}
                        >
                            <Pencil size={14}/>
                            <span>编辑</span>
                        </button>
                        <button className="ghost-button danger-text" type="button"
                                onClick={() => onDelete(entry.id)}>
                            <Trash2 size={14}/>
                            <span>删除</span>
                        </button>
                    </span>
                        </div>))}
        </div>
        {!isLoading && total > 0 && <AdminPagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
        />}
    </div>);
}

/**
 * 访问记录面板，自包含分页/搜索。支持两种模式：独立页（带题库筛选）和嵌入式（固定题库）。
 *
 * @param {object} props 组件属性。
 * @param {(msg: string, type: string) => void} props.addToast 全局 toast 回调。
 * @param {number | null} [props.bankId] 固定题库 ID（嵌入式模式），未传时为独立页模式。
 * @param {Array<{id: number, name: string}>} [props.banks] 题库列表（独立页模式用于筛选下拉）。
 * @returns {JSX.Element} 访问记录面板。
 */
function AccessLogPanel({addToast, bankId, banks}) {
    const isEmbedded = bankId != null;
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [bankFilter, setBankFilter] = useState('');
    const [entries, setEntries] = useState([]);
    const [selectedLogIds, setSelectedLogIds] = useState(() => new Set());
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        let isActive = true;

        async function loadAccessLogs() {
            setIsLoading(true);
            try {
                const effectiveBankId = isEmbedded ? bankId : (bankFilter || null);
                const result = await fetchAdminAccessLogs({
                    limit: pageSize,
                    offset: (page - 1) * pageSize,
                    bankId: effectiveBankId,
                    search: search || undefined,
                });
                if (isActive) {
                    const nextEntries = result.entries;
                    const currentEntryIds = new Set(nextEntries.map((entry) => entry.id));
                    setEntries(nextEntries);
                    setTotal(result.total);
                    setSelectedLogIds((currentIds) => new Set([...currentIds].filter((logId) => currentEntryIds.has(logId))));
                }
            } catch (error) {
                if (isActive) {
                    addToast(error.message, 'error');
                }
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        loadAccessLogs();
        return () => {
            isActive = false;
        };
    }, [addToast, bankId, bankFilter, isEmbedded, page, pageSize, search, reloadKey]);

    const handleSearchChange = useCallback((value) => {
        setSearchInput(value);
        setPage(1);
    }, []);
    const handleFilterChange = useCallback((_key, value) => {
        setBankFilter(value);
        setPage(1);
    }, []);
    const handlePageSizeChange = useCallback((size) => {
        setPageSize(size);
        setPage(1);
    }, []);
    const isAllSelected = areAllEntriesSelected(entries, selectedLogIds);

    const bankFilterOptions = (banks ?? []).map((bank) => ({label: bank.name, value: String(bank.id)}));
    const accessFilters = isEmbedded ? undefined : [{label: '全部题库', value: 'bankId', options: bankFilterOptions},];

    /**
     * 批量删除已选访问记录。
     *
     * @returns {Promise<void>} 无返回值。
     */
    async function handleBatchDeleteLogs() {
        const ids = Array.from(selectedLogIds);
        if (ids.length === 0) {
            addToast('请先选择要删除的访问记录', 'error');
            return;
        }
        if (!window.confirm(`确认删除已选 ${ids.length} 条访问记录？`)) {
            return;
        }
        try {
            const result = await batchDeleteAccessLogs(ids);
            setSelectedLogIds(new Set());
            setReloadKey((key) => key + 1);
            addToast(`已删除 ${result.deleted} 条访问记录`, 'success');
        } catch (error) {
            addToast(error.message, 'error');
        }
    }

    return (<div>
        <div className="panel-title-row">
            <div>
                <h2>访问记录</h2>
                <p className="panel-note">共 {total} 条访问明细</p>
            </div>
            <button
                className="danger-button compact-button"
                type="button"
                disabled={selectedLogIds.size === 0}
                onClick={handleBatchDeleteLogs}
            >
                <Trash2 size={15}/>
                <span>批量删除 {selectedLogIds.size > 0 ? `(${selectedLogIds.size})` : ''}</span>
            </button>
        </div>
        <AdminSearchBar
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            placeholder="搜索访问路径、IP 或地区…"
            filters={accessFilters}
            filterValues={{bankId: bankFilter}}
            onFilterChange={handleFilterChange}
        />
        {entries.length > 0 && <label className="bulk-check-row">
            <input
                checked={isAllSelected}
                type="checkbox"
                onChange={(event) => setSelectedLogIds(event.target.checked ? new Set(entries.map((entry) => entry.id)) : new Set())}
            />
            <span>选择当前页访问记录</span>
        </label>}
        <div className="access-log-list">
            {isLoading ? <p className="empty-state">正在加载访问记录…</p> : entries.length === 0 ?
                <p className="empty-state">暂无访问记录。</p> : entries.map((entry) => (
                    <div className="access-log-item" key={entry.id}>
                        <label className="access-log-select">
                            <input
                                checked={selectedLogIds.has(entry.id)}
                                type="checkbox"
                                aria-label={`选择访问记录 ${entry.page_path}`}
                                onChange={() => setSelectedLogIds((currentIds) => toggleSelectionId(currentIds, entry.id))}
                            />
                        </label>
                        <strong><ExternalLink size={14}/><span>{entry.page_path}</span></strong>
                        <span><MonitorSmartphone size={14}/><span>{entry.device} · {entry.ip_address}</span></span>
                        <span><MapPin size={14}/><span>{entry.region}</span></span>
                        <small><Clock3 size={14}/><span>{formatSubmittedTime(entry.visited_at)}</span></small>
                    </div>))}
        </div>
        {!isLoading && total > 0 && <AdminPagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
        />}
    </div>);
}

/**
 * 加载或错误状态页面。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 状态页。
 */
function LoadingPage({text}) {
    return (<main className="page-shell">
        <section className="loading-panel">{text}</section>
    </main>);
}

/**
 * Toast 容器。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element | null} Toast 堆栈。
 */
function ToastStack({toasts, onDismiss}) {
    if (toasts.length === 0) {
        return null;
    }

    return (<div className="toast-stack" aria-live="polite" aria-label="操作反馈">
        {toasts.map((toast) => (<div className={`toast-item ${toast.type}`} key={toast.id} role="status">
            <span>{toast.text}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="关闭提示">x</button>
        </div>))}
    </div>);
}
