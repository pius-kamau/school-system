// Attendance management system - Frontend logic
class AttendanceManager {
    constructor() {
        this.changes = new Map();
        this.autoSaveTimeout = null;
        this.autoSaveDelay = 2000; // 2 seconds
        this.toast = null;
        this.initializeToast();
    }

    initializeToast() {
        this.toast = new bootstrap.Toast(document.getElementById('liveToast'));
    }

    showNotification(title, message, type = 'info') {
        const toastTitle = document.getElementById('toast-title');
        const toastMessage = document.getElementById('toast-message');
        
        // Set title and message
        toastTitle.textContent = title;
        toastMessage.textContent = message;
        
        // Set color based on type
        const toastHeader = document.querySelector('#liveToast .toast-header');
        toastHeader.className = 'toast-header';
        switch(type) {
            case 'success':
                toastHeader.classList.add('bg-success', 'text-white');
                break;
            case 'error':
                toastHeader.classList.add('bg-danger', 'text-white');
                break;
            case 'warning':
                toastHeader.classList.add('bg-warning');
                break;
            default:
                toastHeader.classList.add('bg-info', 'text-white');
        }
        
        this.toast.show();
    }

    markAttendance(studentId, status) {
        const row = document.querySelector(`tr[data-student-id="${studentId}"]`);
        if (!row) return;

        // Update UI - remove active class from all buttons in this row
        const buttons = row.querySelectorAll('.status-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        
        // Add active class to clicked button
        const clickedBtn = row.querySelector(`.status-btn.${status}`);
        if (clickedBtn) clickedBtn.classList.add('active');

        // Get notes
        const notesInput = document.getElementById(`notes-${studentId}`);
        const notes = notesInput ? notesInput.value : '';

        // Store change
        this.changes.set(studentId, {
            student_id: studentId,
            status: status,
            notes: notes,
            date: document.querySelector('input[name="date"]').value
        });

        // Update last updated time
        this.updateLastUpdatedTime();

        // Auto-save after delay
        this.scheduleAutoSave(studentId);
    }

    updateNotes(studentId, notes) {
        if (this.changes.has(studentId)) {
            this.changes.get(studentId).notes = notes;
            this.scheduleAutoSave(studentId);
        }
    }

    scheduleAutoSave(studentId) {
        // Clear existing timeout
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        // Set new timeout
        this.autoSaveTimeout = setTimeout(() => {
            this.saveAttendance(studentId);
        }, this.autoSaveDelay);
    }

    async saveAttendance(studentId) {
        if (!this.changes.has(studentId)) return;

        const data = this.changes.get(studentId);
        
        try {
            const response = await fetch('/attendance/mark', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            
            if (result.success) {
                this.changes.delete(studentId);
                this.showNotification('Success', 'Attendance saved successfully!', 'success');
            } else {
                this.showNotification('Error', result.error || 'Failed to save', 'error');
            }
        } catch (error) {
            this.showNotification('Error', 'Network error. Please check connection.', 'error');
            console.error('Save error:', error);
        }
    }

    async saveAll() {
        if (this.changes.size === 0) {
            this.showNotification('Info', 'No changes to save', 'info');
            return;
        }

        const promises = Array.from(this.changes.keys()).map(studentId => 
            this.saveAttendance(studentId)
        );

        try {
            await Promise.all(promises);
            this.showNotification('Success', `Saved ${this.changes.size} records`, 'success');
        } catch (error) {
            this.showNotification('Error', 'Some records failed to save', 'error');
        }
    }

    markAll(status) {
        const rows = document.querySelectorAll('tr[data-student-id]');
        let count = 0;

        rows.forEach(row => {
            const studentId = row.dataset.studentId;
            const button = row.querySelector(`.status-btn.${status}`);
            if (button) {
                button.click();
                count++;
            }
        });

        this.showNotification('Bulk Action', `Marked ${count} students as ${status}`, 'info');
    }

    updateLastUpdatedTime() {
        const element = document.getElementById('last-updated');
        if (element) {
            const now = new Date();
            element.textContent = now.toLocaleTimeString();
        }
    }

    goToDate(period) {
        const dateInput = document.querySelector('input[name="date"]');
        if (!dateInput) return;

        const today = new Date();
        let targetDate = new Date();

        switch(period) {
            case 'today':
                targetDate = today;
                break;
            case 'yesterday':
                targetDate = new Date(today);
                targetDate.setDate(today.getDate() - 1);
                break;
            case 'tomorrow':
                targetDate = new Date(today);
                targetDate.setDate(today.getDate() + 1);
                break;
        }

        // Format as YYYY-MM-DD
        const formattedDate = targetDate.toISOString().split('T')[0];
        dateInput.value = formattedDate;
        
        // Submit the form
        dateInput.closest('form').submit();
    }
}

// Initialize attendance manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.attendanceManager = new AttendanceManager();
    
    // Make functions available globally
    window.markAttendance = (studentId, status) => 
        window.attendanceManager.markAttendance(studentId, status);
    
    window.updateNotes = (studentId, notes) => 
        window.attendanceManager.updateNotes(studentId, notes);
    
    window.saveAll = () => window.attendanceManager.saveAll();
    window.markAll = (status) => window.attendanceManager.markAll(status);
    window.goToDate = (period) => window.attendanceManager.goToDate(period);
});