// Admin Quizzes Management - API Integration
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';

let allLessons = [];
let allQuizzes = {};
let currentLesson = 1;

// Error message container
let errorMessageContainer = null;

function initErrorMessageContainer() {
    const container = document.querySelector('.portal-container');
    if (container && !errorMessageContainer) {
        errorMessageContainer = document.createElement('div');
        errorMessageContainer.id = 'errorMessage';
        errorMessageContainer.style.cssText = 'display: none; padding: 12px 16px; margin-bottom: 20px; background: #FEE2E2; border: 1px solid #EF4444; border-radius: 8px; color: #DC2626; font-size: 14px;';
        container.insertBefore(errorMessageContainer, container.firstChild);
    }
}

function showError(message) {
    initErrorMessageContainer();
    if (errorMessageContainer) {
        errorMessageContainer.textContent = message;
        errorMessageContainer.style.display = 'block';
        setTimeout(() => {
            if (errorMessageContainer) errorMessageContainer.style.display = 'none';
        }, 5000);
    } else {
        console.error('Error:', message);
        alert(message);
    }
}

function showSuccess(message) {
    showAlertModal(message, 'Success');
}

// Load lessons for tabs
async function loadLessonsForTabs() {
    try {
        const response = await fetch(`${API_BASE}/lessons`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch lessons');
        }

        const data = await response.json();
        if (data.success && data.lessons) {
            allLessons = data.lessons || [];
            renderLessonTabs();
            if (allLessons.length > 0) {
                currentLesson = allLessons[0].slot || 1;
                await loadQuizzes(currentLesson);
            }
        }
    } catch (error) {
        console.error('Load lessons error:', error);
        showError('Failed to load lessons');
    }
}

// Render lesson tabs
function renderLessonTabs() {
    const tabsContainer = document.getElementById('lessonTabs');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = allLessons.map(lesson => {
        const slot = lesson.slot || 0;
        const lessonName = lesson.lessonName || `Lesson ${slot}`;
        const isActive = slot === currentLesson ? 'active' : '';
        return `
            <button class="lesson-tab ${isActive}" onclick="selectLesson(${slot})">
                ${lessonName}
            </button>
        `;
    }).join('');
}

function selectLesson(lessonSlot) {
    currentLesson = lessonSlot;
    renderLessonTabs();
    loadQuizzes(lessonSlot);
}

// Load quizzes for a specific lesson
async function loadQuizzes(lessonSlot = currentLesson) {
    try {
        const container = document.getElementById('quizzesContainer');
        if (container) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #64748B;">Loading quizzes...</div>';
        }

        const response = await fetch(`${API_BASE}/quizzes/${lessonSlot}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to fetch quizzes');
        }

        const data = await response.json();
        if (!data.success || !data.quizzes) {
            throw new Error('Invalid response from server');
        }

        const quizzes = data.quizzes || [];
        allQuizzes[lessonSlot] = quizzes;
        renderQuizzes(lessonSlot, quizzes);
    } catch (error) {
        console.error('Load quizzes error:', error);
        showError(error.message || 'Failed to load quizzes');
        
        const container = document.getElementById('quizzesContainer');
        if (container) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #64748B;">Failed to load quizzes</div>';
        }
    }
}

// Render quizzes
function renderQuizzes(lessonSlot, quizzes) {
    const container = document.getElementById('quizzesContainer');
    if (!container) return;

    const lesson = allLessons.find(l => l.slot === lessonSlot);
    const lessonName = lesson ? (lesson.lessonName || `Lesson ${lessonSlot}`) : `Lesson ${lessonSlot}`;

    if (quizzes.length === 0) {
        container.innerHTML = `
            <div class="quizzes-section-header">
                <h2>${lessonName}</h2>
            </div>
            <div style="text-align: center; padding: 40px; color: #64748B;">No quizzes found</div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="quizzes-section-header">
            <h2>${lessonName}</h2>
        </div>
        <div class="quizzes-grid-inner">
            ${quizzes.map(quiz => {
                const slot = quiz.slot || 0;
                const question = quiz.question || '(No question set)';
                const answerA = quiz.answerA || '(Not set)';
                const answerB = quiz.answerB || '(Not set)';
                const answerC = quiz.answerC || '(Not set)';
                const answerD = quiz.answerD || '(Not set)';
                const correctAnswer = quiz.correctAnswer || '';
                const explanation = quiz.explanation || '';

                return `
                    <div class="quiz-card">
                        <div class="quiz-card-header">
                            <span class="quiz-number">Question ${slot}</span>
                            <button class="btn-edit" onclick="editQuiz(${lessonSlot}, ${slot})">Edit</button>
                        </div>
                        <h3 class="quiz-question">${question}</h3>
                        <div class="quiz-answers">
                            <div class="answer-item ${correctAnswer === 'A' ? 'correct' : ''}">
                                <span class="answer-label">A:</span>
                                <span>${answerA}</span>
                            </div>
                            <div class="answer-item ${correctAnswer === 'B' ? 'correct' : ''}">
                                <span class="answer-label">B:</span>
                                <span>${answerB}</span>
                            </div>
                            <div class="answer-item ${correctAnswer === 'C' ? 'correct' : ''}">
                                <span class="answer-label">C:</span>
                                <span>${answerC}</span>
                            </div>
                            <div class="answer-item ${correctAnswer === 'D' ? 'correct' : ''}">
                                <span class="answer-label">D:</span>
                                <span>${answerD}</span>
                            </div>
                        </div>
                        ${correctAnswer ? `<div class="correct-answer-badge">Correct Answer: ${correctAnswer}</div>` : ''}
                        <div class="explanation-section">
                            <label class="explanation-label">Explanation:</label>
                            <div class="explanation-text">${explanation || '<span class="explanation-empty">No explanation set. Click Edit to add one.</span>'}</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function openAddQuestionModal() {
    const lesson = allLessons.find(l => l.slot === currentLesson);
    const lessonName = lesson ? (lesson.lessonName || `Lesson ${currentLesson}`) : `Lesson ${currentLesson}`;
    
    document.getElementById('newQuestionLesson').value = currentLesson;
    document.getElementById('newQuestionLessonDisplay').value = lessonName;
    document.getElementById('addQuestionModal').style.display = 'flex';
    document.getElementById('addQuestionForm').reset();
    setupNewQuestionCharCounters();
}

function closeAddQuestionModal() {
    document.getElementById('addQuestionModal').style.display = 'none';
}

async function saveNewQuestion(event) {
    event.preventDefault();
    
    const lesson = parseInt(document.getElementById('newQuestionLesson').value);
    const question = document.getElementById('newQuestion').value.trim();
    const answerA = document.getElementById('newAnswerA').value.trim();
    const answerB = document.getElementById('newAnswerB').value.trim();
    const answerC = document.getElementById('newAnswerC').value.trim();
    const answerD = document.getElementById('newAnswerD').value.trim();
    const correctAnswer = document.getElementById('newCorrectAnswer').value;
    const explanation = document.getElementById('newExplanation').value.trim();

    if (!question || !answerA || !answerB || !answerC || !answerD || !correctAnswer) {
        showError('All fields are required');
        return;
    }

    // Find next available slot
    const quizzes = allQuizzes[lesson] || [];
    const nextSlot = quizzes.length > 0 ? Math.max(...quizzes.map(q => q.slot || 0)) + 1 : 1;

    try {
        const response = await fetch(`${API_BASE}/quizzes/${lesson}/${nextSlot}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question,
                answerA,
                answerB,
                answerC,
                answerD,
                correctAnswer,
                explanation
            })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save question');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Question added successfully');
            closeAddQuestionModal();
            await loadQuizzes(lesson);
        }
    } catch (error) {
        console.error('Save new question error:', error);
        showError(error.message || 'Failed to save question');
    }
}

function editQuiz(lesson, slot) {
    const quizzes = allQuizzes[lesson] || [];
    const quiz = quizzes.find(q => q.slot === slot);
    if (!quiz) {
        showError('Quiz not found');
        return;
    }

    const lessonObj = allLessons.find(l => l.slot === lesson);
    const lessonName = lessonObj ? (lessonObj.lessonName || `Lesson ${lesson}`) : `Lesson ${lesson}`;
    
    document.getElementById('quizLesson').value = lesson;
    document.getElementById('quizSlot').value = slot;
    document.getElementById('quizLessonDisplay').value = lessonName;
    document.getElementById('quizQuestion').value = quiz.question || '';
    document.getElementById('quizAnswerA').value = quiz.answerA || '';
    document.getElementById('quizAnswerB').value = quiz.answerB || '';
    document.getElementById('quizAnswerC').value = quiz.answerC || '';
    document.getElementById('quizAnswerD').value = quiz.answerD || '';
    document.getElementById('quizCorrectAnswer').value = quiz.correctAnswer || '';
    document.getElementById('quizExplanation').value = quiz.explanation || '';
    document.getElementById('quizModalTitle').textContent = `Edit Question ${slot} - ${lessonName}`;
    document.getElementById('quizModal').style.display = 'flex';
    
    setTimeout(() => {
        updateCharCount('quizQuestion', 'questionCharCount', 90);
        updateCharCount('quizAnswerA', 'answerACharCount', 30);
        updateCharCount('quizAnswerB', 'answerBCharCount', 30);
        updateCharCount('quizAnswerC', 'answerCCharCount', 30);
        updateCharCount('quizAnswerD', 'answerDCharCount', 30);
        setupCharCounters();
    }, 100);
}

function closeQuizModal() {
    document.getElementById('quizModal').style.display = 'none';
    document.getElementById('quizForm').reset();
    updateCharCount('quizQuestion', 'questionCharCount', 90);
    updateCharCount('quizAnswerA', 'answerACharCount', 30);
    updateCharCount('quizAnswerB', 'answerBCharCount', 30);
    updateCharCount('quizAnswerC', 'answerCCharCount', 30);
    updateCharCount('quizAnswerD', 'answerDCharCount', 30);
}

async function saveQuiz(event) {
    event.preventDefault();
    
    const lesson = parseInt(document.getElementById('quizLesson').value);
    const slot = parseInt(document.getElementById('quizSlot').value);
    const question = document.getElementById('quizQuestion').value.trim();
    const answerA = document.getElementById('quizAnswerA').value.trim();
    const answerB = document.getElementById('quizAnswerB').value.trim();
    const answerC = document.getElementById('quizAnswerC').value.trim();
    const answerD = document.getElementById('quizAnswerD').value.trim();
    const correctAnswer = document.getElementById('quizCorrectAnswer').value;
    const explanation = document.getElementById('quizExplanation').value.trim();

    if (!question || !answerA || !answerB || !answerC || !answerD || !correctAnswer) {
        showError('All fields are required');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/quizzes/${lesson}/${slot}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question,
                answerA,
                answerB,
                answerC,
                answerD,
                correctAnswer,
                explanation
            })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save quiz');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Quiz saved successfully');
            closeQuizModal();
            await loadQuizzes(lesson);
        }
    } catch (error) {
        console.error('Save quiz error:', error);
        showError(error.message || 'Failed to save quiz');
    }
}

// Character counters
function updateCharCount(inputId, counterId, maxLength) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (input && counter) {
        const currentLength = input.value.length;
        counter.textContent = currentLength;
        if (currentLength >= maxLength) {
            counter.parentElement.classList.add('char-limit-reached');
        } else {
            counter.parentElement.classList.remove('char-limit-reached');
        }
    }
}

function setupCharCounters() {
    const questionInput = document.getElementById('quizQuestion');
    const answerAInput = document.getElementById('quizAnswerA');
    const answerBInput = document.getElementById('quizAnswerB');
    const answerCInput = document.getElementById('quizAnswerC');
    const answerDInput = document.getElementById('quizAnswerD');
    
    if (questionInput) {
        questionInput.addEventListener('input', () => updateCharCount('quizQuestion', 'questionCharCount', 90));
    }
    if (answerAInput) {
        answerAInput.addEventListener('input', () => updateCharCount('quizAnswerA', 'answerACharCount', 30));
    }
    if (answerBInput) {
        answerBInput.addEventListener('input', () => updateCharCount('quizAnswerB', 'answerBCharCount', 30));
    }
    if (answerCInput) {
        answerCInput.addEventListener('input', () => updateCharCount('quizAnswerC', 'answerCCharCount', 30));
    }
    if (answerDInput) {
        answerDInput.addEventListener('input', () => updateCharCount('quizAnswerD', 'answerDCharCount', 30));
    }
}

function setupNewQuestionCharCounters() {
    const questionInput = document.getElementById('newQuestion');
    const answerAInput = document.getElementById('newAnswerA');
    const answerBInput = document.getElementById('newAnswerB');
    const answerCInput = document.getElementById('newAnswerC');
    const answerDInput = document.getElementById('newAnswerD');
    
    if (questionInput) {
        questionInput.addEventListener('input', () => updateCharCount('newQuestion', 'newQuestionCharCount', 90));
    }
    if (answerAInput) {
        answerAInput.addEventListener('input', () => updateCharCount('newAnswerA', 'newAnswerACharCount', 30));
    }
    if (answerBInput) {
        answerBInput.addEventListener('input', () => updateCharCount('newAnswerB', 'newAnswerBCharCount', 30));
    }
    if (answerCInput) {
        answerCInput.addEventListener('input', () => updateCharCount('newAnswerC', 'newAnswerCCharCount', 30));
    }
    if (answerDInput) {
        answerDInput.addEventListener('input', () => updateCharCount('newAnswerD', 'newAnswerDCharCount', 30));
    }
}

function logout() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'flex';
}

function closeLogoutModal() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'none';
}

function confirmLogout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminData');
    window.location.href = '/admin-login';
}

function showAlertModal(message, title = 'Notice') {
    const modal = document.getElementById('alertModal');
    const msg = document.getElementById('alertMessage');
    const ttl = document.getElementById('alertTitle');
    if (!modal || !msg || !ttl) {
        alert(message);
        return;
    }
    ttl.textContent = title;
    msg.textContent = message;
    modal.style.display = 'flex';
}

function closeAlertModal() {
    const modal = document.getElementById('alertModal');
    if (modal) modal.style.display = 'none';
}

// Modal close on outside click
window.onclick = function(event) {
    const modals = ['quizModal', 'logoutModal', 'addQuestionModal', 'alertModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'quizModal') closeQuizModal();
            else if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'addQuestionModal') closeAddQuestionModal();
            else if (modalId === 'alertModal') closeAlertModal();
        }
    });
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initErrorMessageContainer();
    loadLessonsForTabs();
});









