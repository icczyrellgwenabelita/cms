import React from 'react';

const StudentInfoCard = ({
  studentNumber = '',
  batch = '',
  status = 'active',
  stats = {
    lessons: '0 / 6',
    quizzes: '0 / 6',
    simulations: '0 / 3',
    certificates: '0 / 3',
  },
}) => {
  const statItems = [
    { id: 'lessons', label: 'Lessons Completed', value: stats.lessons },
    { id: 'quizzes', label: 'Quizzes Completed', value: stats.quizzes },
    { id: 'simulations', label: 'Simulations', value: stats.simulations },
    { id: 'certificates', label: 'Certificates', value: stats.certificates },
  ];

  return (
    <article className="profile-card student-info-card">
      <div className="card-header">
        <h2>Student Information</h2>
        <p className="card-subtitle">Core student overview and learning snapshot.</p>
      </div>
      <div className="student-info-body">
        <div className="student-info-fields-grid">
          <div className="info-tile">
            <span className="info-tile-label">Student Number</span>
            <strong>{studentNumber || '--'}</strong>
          </div>
          <div className="info-tile">
            <span className="info-tile-label">Batch</span>
            <strong>{batch || '--'}</strong>
          </div>
          <div className="field-group">
            <label htmlFor="statusFieldReadonly">Status</label>
            <input
              id="statusFieldReadonly"
              type="text"
              value={status}
              readOnly
            />
          </div>
          <div className="field-group field-placeholder" aria-hidden="true" />
        </div>
        <div className="student-info-divider" />
        <div className="student-info-stats">
          {statItems.map((stat) => (
            <div key={stat.id} className="student-stat-box">
              <span className="student-stat-label">{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
};

export default StudentInfoCard;

