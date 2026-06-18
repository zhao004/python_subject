import {useCallback, useEffect, useMemo, useState} from 'react';
import {fetchLeaderboard, fetchQuiz, submitScore} from './api.js';

const DEFAULT_MESSAGE = '先点击任意英文或中文，计时从第一次操作开始';
const QUIZ_ROUTE = '/';
const LEADERBOARD_ROUTE = '/leaderboard';
const LEADERBOARD_LIMIT = 50;
const ONE_SECOND_MS = 1000;
const TOAST_LIFETIME_MS = 3000;
const STUDENT_PROFILE_STORAGE_KEY = 'wordMatchStudentProfile:v1';
const STUDENT_ID_LENGTH = 9;
const STUDENT_ID_PATTERN = /^\d{9}$/;
const FIELD_LIMITS = {
    studentClass: 40, studentId: STUDENT_ID_LENGTH, studentName: 40,
};
const DEFAULT_STUDENT_FORM = {
    studentClass: '', studentId: '', studentName: '',
};

let nextToastId = 1;

/**
 * 读取当前前端路由，只保留应用支持的页面，避免未知路径导致空白页。
 *
 * @returns {string} 当前页面路由。
 */
function getCurrentRoute() {
    return window.location.pathname === LEADERBOARD_ROUTE ? LEADERBOARD_ROUTE : QUIZ_ROUTE;
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
    const safeSeconds = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 将服务端提交时间格式化为本地可读时间。
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
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
}

/**
 * 构建左右两列卡片。
 *
 * @param {Array<object>} wordPairs 后端返回的词汇配对。
 * @returns {{leftItems: Array<object>, rightItems: Array<object>}} 随机后的左右列表。
 */
function buildBoard(wordPairs) {
    const leftItems = wordPairs.map((item) => ({
        uid: `left-${item.id}`, pairId: item.id, side: 'left', text: item.english,
    }));
    const rightItems = wordPairs.map((item) => ({
        uid: `right-${item.id}`, pairId: item.id, side: 'right', text: item.chinese,
    }));

    return {
        leftItems: shuffleItems(leftItems), rightItems: shuffleItems(rightItems),
    };
}

/**
 * 将学生信息统一裁剪并去除首尾空白，保证校验、存储和提交使用同一份口径。
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
        if (value.length > FIELD_LIMITS[fieldName]) {
            return `${label}不能超过 ${FIELD_LIMITS[fieldName]} 个字符`;
        }
    }

    if (!STUDENT_ID_PATTERN.test(normalizedForm.studentId)) {
        return `学号必须是 ${STUDENT_ID_LENGTH} 位数字`;
    }

    return '';
}

/**
 * 从本地读取已记住的学生信息；读取失败时回退为空表单，避免浏览器隐私策略阻断页面。
 *
 * @returns {{form: object, rememberStudent: boolean}} 本地记忆状态。
 */
function readRememberedStudentProfile() {
    try {
        const rawProfile = window.localStorage.getItem(STUDENT_PROFILE_STORAGE_KEY);
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
 * 保存学生信息到本地；失败时返回 false，由调用方决定是否用 Toast 提醒。
 *
 * @param {object} form 已通过校验的学生信息。
 * @returns {boolean} 是否保存成功。
 */
function saveRememberedStudentProfile(form) {
    try {
        window.localStorage.setItem(STUDENT_PROFILE_STORAGE_KEY, JSON.stringify(normalizeStudentForm(form)));
        return true;
    } catch {
        return false;
    }
}

/**
 * 清除已记住的学生信息；清理失败不影响本次答题流程。
 */
function removeRememberedStudentProfile() {
    try {
        window.localStorage.removeItem(STUDENT_PROFILE_STORAGE_KEY);
    } catch {
        // 浏览器可能禁用本地存储，清理失败时保持静默，后续提交仍由表单校验兜底。
    }
}

/**
 * 单词配对测验主应用。
 *
 * @returns {JSX.Element} 应用界面。
 */
export default function App() {
    const [rememberedStudentProfile] = useState(readRememberedStudentProfile);
    const [route, setRoute] = useState(getCurrentRoute);
    const [toasts, setToasts] = useState([]);
    const [quiz, setQuiz] = useState(null);
    const [leftItems, setLeftItems] = useState([]);
    const [rightItems, setRightItems] = useState([]);
    const [selectedItem, setSelectedItem] = useState(null);
    const [matchedPairIds, setMatchedPairIds] = useState(() => new Set());
    const [message, setMessage] = useState(DEFAULT_MESSAGE);
    const [studentForm, setStudentForm] = useState(rememberedStudentProfile.form);
    const [rememberStudent, setRememberStudent] = useState(rememberedStudentProfile.rememberStudent);
    const [identityError, setIdentityError] = useState('');
    const [isIdentityConfirmed, setIsIdentityConfirmed] = useState(false);
    const [startedAt, setStartedAt] = useState(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [timerStopped, setTimerStopped] = useState(false);
    const [leaderboard, setLeaderboard] = useState([]);
    const [lastResult, setLastResult] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);

    const matchedCount = matchedPairIds.size;
    const score = quiz ? Math.round(matchedCount * quiz.points_per_pair) : 0;
    const totalPairs = quiz?.total_pairs ?? 0;
    const shouldShowIdentityModal = route === QUIZ_ROUTE && !isIdentityConfirmed;

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
    }, [removeToast],);

    useEffect(() => {
        const handlePopState = () => {
            setRoute(getCurrentRoute());
        };
        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    useEffect(() => {
        let isActive = true;

        async function loadQuizData() {
            try {
                const quizData = await fetchQuiz();
                if (!isActive) {
                    return;
                }
                setQuiz(quizData);
                const board = buildBoard(quizData.word_pairs);
                setLeftItems(board.leftItems);
                setRightItems(board.rightItems);
            } catch (error) {
                showStatus('测验数据加载失败，请刷新页面重试');
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
    }, [addToast]);

    useEffect(() => {
        if (route !== LEADERBOARD_ROUTE) {
            return undefined;
        }

        let isActive = true;

        async function loadLeaderboardData() {
            setIsLeaderboardLoading(true);
            try {
                const leaderboardData = await fetchLeaderboard(LEADERBOARD_LIMIT);
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
    }, [addToast, route]);

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
     * 切换前端页面，使用 History API 让刷新和后退按钮保持一致。
     *
     * @param {string} nextRoute 目标页面路由。
     */
    function navigateTo(nextRoute) {
        const normalizedRoute = nextRoute === LEADERBOARD_ROUTE ? LEADERBOARD_ROUTE : QUIZ_ROUTE;
        if (normalizedRoute === route) {
            return;
        }
        window.history.pushState(null, '', normalizedRoute);
        setRoute(normalizedRoute);
    }

    /**
     * 设置中性操作提示。成功和错误反馈统一交给 Toast，避免状态栏颜色频繁跳变。
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
     * 确认入场身份信息，校验通过后才允许开始答题。
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
            const isSaved = saveRememberedStudentProfile(normalizedForm);
            if (!isSaved) {
                addToast('浏览器无法记住学生信息，本次仍可继续答题', 'error');
            }
        } else {
            removeRememberedStudentProfile();
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
     * 处理卡片点击，包含计时启动、选择切换和配对判定。
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
            showStatus(item.side === 'left' ? '已选英文，请点击对应中文' : '已选中文，请点击对应英文');
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
        const validationMessage = validateStudentForm(studentForm);
        if (validationMessage) {
            addToast(validationMessage, 'error');
            return;
        }

        setIsSubmitting(true);
        try {
            const normalizedForm = normalizeStudentForm(studentForm);
            if (rememberStudent) {
                saveRememberedStudentProfile(normalizedForm);
            }
            const liveElapsedSeconds = startedAt === null || timerStopped ? elapsedSeconds : Math.floor((Date.now() - startedAt) / ONE_SECOND_MS);
            const result = await submitScore({
                student_class: normalizedForm.studentClass,
                student_id: normalizedForm.studentId,
                student_name: normalizedForm.studentName,
                elapsed_seconds: liveElapsedSeconds,
                matched_pair_ids: Array.from(matchedPairIds),
            });
            setLastResult(result);
            setElapsedSeconds(liveElapsedSeconds);
            showStatus('成绩已提交，可继续练习或查看排行榜');
            addToast(result.saved_as_best ? '成绩已保存为个人最佳记录' : '本次成绩未超过个人最佳记录', 'success',);
        } catch (error) {
            addToast(error.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    }

    const page = route === LEADERBOARD_ROUTE ? (<LeaderboardPage
        entries={leaderboard}
        isLoading={isLeaderboardLoading}
        onNavigateHome={() => navigateTo(QUIZ_ROUTE)}
    />) : (<QuizPage
        quiz={quiz}
        leftItems={leftItems}
        rightItems={rightItems}
        matchedPairIds={matchedPairIds}
        selectedItem={selectedItem}
        studentForm={studentForm}
        message={message}
        matchedCount={matchedCount}
        totalPairs={totalPairs}
        score={score}
        elapsedSeconds={elapsedSeconds}
        lastResult={lastResult}
        isLoading={isLoading}
        isSubmitting={isSubmitting}
        onCardClick={handleCardClick}
        onResetGame={resetGame}
        onSubmitScore={handleSubmitScore}
        onStudentFormChange={updateStudentForm}
        onNavigateLeaderboard={() => navigateTo(LEADERBOARD_ROUTE)}
    />);

    return (<>
        {page}
        {shouldShowIdentityModal && (<StudentIdentityModal
            errorMessage={identityError}
            form={studentForm}
            rememberStudent={rememberStudent}
            onConfirm={confirmStudentIdentity}
            onFormChange={updateStudentForm}
            onRememberChange={setRememberStudent}
        />)}
        <ToastStack toasts={toasts} onDismiss={removeToast}/>
    </>);
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
                      isSubmitting,
                      onCardClick,
                      onResetGame,
                      onSubmitScore,
                      onStudentFormChange,
                      onNavigateLeaderboard,
                  }) {
    if (isLoading) {
        return (<main className="page-shell">
            <section className="loading-panel">正在加载测验数据...</section>
        </main>);
    }

    if (!quiz) {
        return (<main className="page-shell">
            <section className="loading-panel">测验数据不可用，请刷新页面重试。</section>
        </main>);
    }

    return (<main className="page-shell">
        <section className="exam-board">
            <header className="exam-header">
                <div className="exam-copy">
                    <p className="eyebrow">20 组中英配对</p>
                    <h1>单词短语匹配测验</h1>
                </div>
                <div className="student-form" aria-label="学生信息">
                    <label>
                        <span>班级</span>
                        <input
                            value={studentForm.studentClass}
                            maxLength={FIELD_LIMITS.studentClass}
                            onChange={(event) => onStudentFormChange('studentClass', event.target.value)}
                            placeholder="例如：一班"
                        />
                    </label>
                    <label>
                        <span>学号</span>
                        <input
                            value={studentForm.studentId}
                            inputMode="numeric"
                            maxLength={FIELD_LIMITS.studentId}
                            onChange={(event) => onStudentFormChange('studentId', event.target.value)}
                            placeholder="例如：001234567"
                        />
                    </label>
                    <label>
                        <span>姓名</span>
                        <input
                            value={studentForm.studentName}
                            maxLength={FIELD_LIMITS.studentName}
                            onChange={(event) => onStudentFormChange('studentName', event.target.value)}
                            placeholder="例如：张三"
                        />
                    </label>
                </div>
            </header>

            <section className="status-grid" aria-label="测验状态">
                <div className="status-card">
                    <span>配对</span>
                    <strong>
                        {matchedCount}/{totalPairs}
                    </strong>
                </div>
                <div className="status-card">
                    <span>得分</span>
                    <strong>{score}/100</strong>
                </div>
                <div className="status-card timer-card">
                    <span>用时</span>
                    <strong>{formatElapsedTime(elapsedSeconds)}</strong>
                </div>
                <div className="message-card" role="status" aria-live="polite">
                    {message}
                </div>
            </section>

            <section className="content-grid quiz-content-grid">
                <div className="match-panel">
                    <div className="table-head">
                        <span>英文 / 短语</span>
                        <span>中文释义</span>
                    </div>
                    <div className="match-table" role="list">
                        {leftItems.map((leftItem, index) => {
                            const rightItem = rightItems[index];
                            return (<div className="match-row" key={`${leftItem.uid}-${rightItem.uid}`}>
                                <MatchCard
                                    item={leftItem}
                                    isMatched={matchedPairIds.has(leftItem.pairId)}
                                    isSelected={selectedItem?.uid === leftItem.uid}
                                    onClick={onCardClick}
                                />
                                <MatchCard
                                    item={rightItem}
                                    isMatched={matchedPairIds.has(rightItem.pairId)}
                                    isSelected={selectedItem?.uid === rightItem.uid}
                                    onClick={onCardClick}
                                />
                            </div>);
                        })}
                    </div>
                    <div className="action-row">
                        <button className="secondary-button" type="button" onClick={onResetGame}>
                            重新随机排序
                        </button>
                        <button className="secondary-button" type="button" onClick={onNavigateLeaderboard}>
                            查看排行榜
                        </button>
                        <button
                            className="primary-button"
                            type="button"
                            disabled={isSubmitting}
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
 * 独立排行榜页面。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 排行榜页面。
 */
function LeaderboardPage({entries, isLoading, onNavigateHome}) {
    return (<main className="page-shell leaderboard-page-shell">
        <section className="leaderboard-page">
            <header className="leaderboard-hero">
                <div>
                    <p className="eyebrow">Top 50</p>
                    <h1>全局排行榜</h1>
                    <p className="exam-lede">按分数从高到低排序，同分时用时更短排名更靠前。</p>
                </div>
                <button className="secondary-button hero-button" type="button" onClick={onNavigateHome}>
                    返回答题
                </button>
            </header>

            <section className="leaderboard-page-panel" aria-label="全局前50名排行榜">
                {isLoading ? (<div
                    className="loading-panel compact-loading">正在加载排行榜...</div>) : entries.length === 0 ? (
                    <p className="empty-state leaderboard-empty">暂无成绩，提交后会出现在这里。</p>) : (<>
                    <div className="leaderboard-table" role="table" aria-label="全局排行榜前50名">
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
                        {entries.map((entry) => (<LeaderboardTableRow entry={entry} key={entry.id}/>))}
                    </div>
                    <ol className="leaderboard-card-list">
                        {entries.map((entry) => (<LeaderboardCard entry={entry} key={entry.id}/>))}
                    </ol>
                </>)}
            </section>
        </section>
    </main>);
}

/**
 * PC 端排行榜行。
 *
 * @param {object} props 组件属性。
 * @param {object} props.entry 排行榜条目。
 * @returns {JSX.Element} 表格行。
 */
function LeaderboardTableRow({entry}) {
    return (<div className="leaderboard-table-row" role="row">
      <span className="rank rank-inline" role="cell">
        {entry.rank}
      </span>
        <strong role="cell">{entry.student_name}</strong>
        <span role="cell">{entry.student_class}</span>
        <span role="cell">{entry.student_id}</span>
        <strong className="leaderboard-score" role="cell">
            {entry.score}
        </strong>
        <span role="cell">
        {entry.correct_count}/{entry.total_pairs}
      </span>
        <span role="cell">{formatElapsedTime(entry.elapsed_seconds)}</span>
        <span role="cell">{formatSubmittedTime(entry.submitted_at)}</span>
    </div>);
}

/**
 * 移动端排行榜卡片。
 *
 * @param {object} props 组件属性。
 * @param {object} props.entry 排行榜条目。
 * @returns {JSX.Element} 卡片节点。
 */
function LeaderboardCard({entry}) {
    return (<li className="leaderboard-card">
        <div className="leaderboard-card-top">
            <span className="rank">{entry.rank}</span>
            <div>
                <strong>{entry.student_name}</strong>
                <small>
                    {entry.student_class} · {entry.student_id}
                </small>
            </div>
            <strong className="leaderboard-score">{entry.score}</strong>
        </div>
        <dl className="leaderboard-card-meta">
            <div>
                <dt>正确数</dt>
                <dd>
                    {entry.correct_count}/{entry.total_pairs}
                </dd>
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
function StudentIdentityModal({
                                  errorMessage, form, rememberStudent, onConfirm, onFormChange, onRememberChange,
                              }) {
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
                <label>
                    <span>班级</span>
                    <input
                        autoFocus
                        value={form.studentClass}
                        maxLength={FIELD_LIMITS.studentClass}
                        onChange={(event) => onFormChange('studentClass', event.target.value)}
                        placeholder="例如：一班"
                    />
                </label>
                <label>
                    <span>学号</span>
                    <input
                        value={form.studentId}
                        inputMode="numeric"
                        maxLength={FIELD_LIMITS.studentId}
                        onChange={(event) => onFormChange('studentId', event.target.value)}
                        placeholder="例如：001234567"
                    />
                </label>
                <label>
                    <span>姓名</span>
                    <input
                        value={form.studentName}
                        maxLength={FIELD_LIMITS.studentName}
                        onChange={(event) => onFormChange('studentName', event.target.value)}
                        placeholder="例如：张三"
                    />
                </label>
                <label className="remember-row">
                    <input
                        checked={rememberStudent}
                        type="checkbox"
                        onChange={(event) => onRememberChange(event.target.checked)}
                    />
                    <span>记住这次填写的信息</span>
                </label>
                {errorMessage && (<p className="identity-error" role="alert">
                    {errorMessage}
                </p>)}
                <button className="primary-button identity-submit" type="submit">
                    确认并开始
                </button>
            </form>
        </section>
    </div>);
}

/**
 * Toast 容器。
 *
 * @param {object} props 组件属性。
 * @param {Array<object>} props.toasts Toast 列表。
 * @param {(id: number) => void} props.onDismiss 关闭回调。
 * @returns {JSX.Element | null} Toast 堆栈。
 */
function ToastStack({toasts, onDismiss}) {
    if (toasts.length === 0) {
        return null;
    }

    return (<div className="toast-stack" aria-live="polite" aria-label="操作反馈">
        {toasts.map((toast) => (<div className={`toast-item ${toast.type}`} key={toast.id} role="status">
            <span>{toast.text}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="关闭提示">
                ×
            </button>
        </div>))}
    </div>);
}

/**
 * 单张配对卡片。
 *
 * @param {object} props 组件属性。
 * @param {object} props.item 卡片数据。
 * @param {boolean} props.isMatched 是否已匹配。
 * @param {boolean} props.isSelected 是否被选中。
 * @param {(item: object) => void} props.onClick 点击回调。
 * @returns {JSX.Element} 卡片节点。
 */
function MatchCard({item, isMatched, isSelected, onClick}) {
    const className = ['match-card', item.side === 'left' ? 'left-card' : 'right-card', isMatched ? 'matched' : '', isSelected ? 'selected' : '',]
        .filter(Boolean)
        .join(' ');

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
 * @param {object} props.result 服务端提交结果。
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
            <strong>
                {record.student_class} · {record.student_name} · {record.student_id}
            </strong>
        </div>
        <div>
            <span>成绩</span>
            <strong>
                {record.correct_count}/{record.total_pairs} · {record.score} 分 ·{' '}
                {formatElapsedTime(record.elapsed_seconds)}
            </strong>
        </div>
    </section>);
}
