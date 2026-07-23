
class MoodleClient {
  constructor(baseUrl = null, token = null) {
    this.baseUrl = baseUrl || process.env.MOODLE_URL || 'https://lms.thinklabs.com.vn';
    this.token = token || process.env.MOODLE_TOKEN || 'c85585dea8d2b5bc0deeae527b159ca5';
  }

  async fetchMoodle(wsfunction, params = {}) {
    const searchParams = new URLSearchParams({
      wstoken: this.token,
      wsfunction: wsfunction,
      moodlewsrestformat: 'json',
      ...Object.entries(params).reduce((acc, [key, val]) => ({ ...acc, [key]: String(val) }), {}),
    });

    const response = await fetch(`${this.baseUrl}/webservice/rest/server.php?${searchParams.toString()}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Moodle API Error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data === null) {
      return null;
    }

    if (data.exception) {
      throw new Error(`Moodle Exception: ${data.message} (${data.errorcode})`);
    }

    return data;
  }

  // --- Courses ---

  async getCourses() {
    return await this.fetchMoodle('core_course_get_courses');
  }

  async getCourseCategories() {
    return await this.fetchMoodle('core_course_get_categories');
  }

  async getCourseById(courseId) {
    const response = await this.fetchMoodle('core_course_get_courses_by_field', {
      field: 'id',
      value: courseId,
    });
    return response.courses?.[0] || null;
  }

  async getCourseContents(courseId) {
    return await this.fetchMoodle('core_course_get_contents', { courseid: courseId });
  }

  // --- Assignments ---

  async getAssignments(courseId) {
    const searchParams = new URLSearchParams({
      wstoken: this.token,
      wsfunction: 'mod_assign_get_assignments',
      moodlewsrestformat: 'json',
      'courseids[0]': String(courseId),
    });
    const response = await fetch(`${this.baseUrl}/webservice/rest/server.php?${searchParams.toString()}`, {
      method: 'POST',
    });
    const result = await response.json();

    return result.courses?.[0]?.assignments || [];
  }

  // --- Grades ---

  async updateGrade(assignmentId, userId, grade, feedback = '') {
    const payload = {
      assignmentid: assignmentId,
      userid: userId,
      grade: grade,
      attemptnumber: -1,
      addattempt: 0,
      workflowstate: 'graded',
      applytoall: 0,
    };

    if (feedback) {
      payload['plugindata[assignfeedbackcomments_editor][text]'] = feedback;
      payload['plugindata[assignfeedbackcomments_editor][format]'] = 1;
    }

    return await this.fetchMoodle('mod_assign_save_grade', payload);
  }
}

const moodleClient = new MoodleClient();

module.exports = {
  MoodleClient,
  moodleClient,
};
