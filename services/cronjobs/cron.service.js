'use strict';
const CronJob = require('moleculer-cron');
const { CronTime } = require('cron');

/** @type {ServiceSchema} */
module.exports = {
  name: 'cronjobs',
  mixins: [CronJob],
  dependencies: ['settings'],
  settings: {
    runOnInit: true,
    cronJobs: [
      {
        // Define your cron expression (runs at 1h every day)
        name: 'clear-storage',
        cronTime: '0 1 * * *',
        async onTick() {
          try {
            console.log('Job clear audio');
            await this.broker.call('audios.clearAudio');
            console.log('Job clear image');
            await this.broker.call('images.clearImage');
            console.log('Job clear file student upload');
            await this.broker.emit('jobClearFileStudentUpload');
          } catch (error) {
            console.error('Error:', error.message);
          }
        },
      },
      {
        name: 'mark-overdue-courses-every-day',
        cronTime: '2 0 * * *',
        timeZone: 'Asia/Ho_Chi_Minh',
        async onTick() {
          try {
            // console.log('[CRON] Mark overdue courses');
            await this.broker.call('courses.markOverdue');
          } catch (err) {
            this.logger.error('[CRON] markOverdue failed', err);
          }
        },
      },
      {
        name: 'warning-courses-overdue',
        cronTime: '0 5 * * *',
        timeZone: 'Asia/Ho_Chi_Minh',
        async onTick() {
          try {
            await this.broker.call('courses.warningCoursesOverdue');
            // console.log('warningCoursesOverdue');
          } catch (err) {
            this.logger.error('[CRON] warningCoursesOverdue failed', err);
          }
        }
      },
    ],
  },

  actions: {},
  methods: {},
  events: {},
  /**
   * Service created lifecycle event handler
   */
  created() { },

  /**
   * Service started lifecycle event handler
   */
  async started() { },

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() { },
};
