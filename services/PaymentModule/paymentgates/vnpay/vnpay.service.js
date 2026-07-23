const dayjs = require("dayjs");
const qs = require("qs");
const CryptoJS = require('crypto-js');
const VnpTransaction = require('./transaction.model');
const VnpLog = require('./log.model');

module.exports = {
  name: "vnpay",
  mixins: [],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {},
    populateOptions: [],
    vnpayConfig: {
      vnp_TmnCode: process.env.VNPAY_TMN || "CLKETEST",
      vnp_HashSecret: process.env.VNPAY_HASH || "SQV53YQ7G82ASHBAQ7KO1SFZZCYSD39Y",
      vnp_Url: process.env.VNPAY_URL || "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      vnp_ReturnUrl: `${process.env.DOMAIN || "http://localhost:8080"}/payment/vnpay/return`,
      vnp_Whitelist: `${process.env.VNPAY_WHITELIST || "113.160.92.202,203.205.17.226,103.220.84.4"}`,
    },
  },

  hooks: {},

  actions: {
    createPaymentUrl: {
      // rest: "POST /createPaymentUrl",
      params: {
        order: "object",
        customer: "object",
        transactionId: "string",
      },
      async handler(ctx) {
        const {order, customer, transactionId} = ctx.params;
        const date = new Date();
        const startDate = formatDateVnpay(date);
        const endDate = formatDateVnpay(dayjs(date).add(30, 'minute'));
        const vnpExpireDate = dayjs(date).add(30, 'minute');
        const txnRef = getTxnRefAndOrderInDay();
        const {vnp_TmnCode, vnp_ReturnUrl, vnp_HashSecret} = this.settings.vnpayConfig;
        const vnpParams = {
          vnp_Version: '2.1.0',
          vnp_Command: 'pay',
          vnp_TmnCode: vnp_TmnCode,
          vnp_Locale: order.locale || 'vn',
          vnp_CurrCode: order.currency || 'VND',
          vnp_TxnRef: txnRef,
          vnp_OrderInfo: removeVietnameseTones(`${customer.id}-${order.id}-${order.service}-${order.type}-${order.amount}-${order.currency}-${startDate}-${endDate}`),
          // vnp_OrderInfo: "Test",
          vnp_OrderType: order.type || 'other',
          vnp_Amount: order.amount * 100,
          vnp_ReturnUrl: `${vnp_ReturnUrl}?transactionId=${transactionId}`,
          vnp_IpAddr: ctx.meta.client_ip,
          vnp_CreateDate: startDate,
          vnp_ExpireDate: endDate,
          // vnp_BankCode: order.bank_code || undefined,
        };

        const vnpParamsSorted = sortObjectVnpay(vnpParams);
        let signData = encodeData(vnpParamsSorted);
        vnpParamsSorted['vnp_SecureHash'] = genHash(signData, vnp_HashSecret);
        const vnpUrl = this.settings.vnpayConfig.vnp_Url + '?' + encodeData(vnpParamsSorted);
        const transactionPayload = {
          date: date,
          amount: order.amount,
          txnRef: txnRef,
          transactionId
        };
        const createLog = await VnpLog.create({url: vnpUrl, type: 1});
        transactionPayload.createLogId = createLog._id;
        await VnpTransaction.create(transactionPayload);

        return {paymentUrl: vnpUrl, tmnCode: vnp_TmnCode, txnRef: txnRef, vnpExpireDate};
      }
    },
    returnURL: {
      rest: 'GET /return',
      async handler(ctx) {
        let vnp_Params = sortObjectVnpay(ctx.params);
        let secureHash = vnp_Params.vnp_SecureHash;
        delete vnp_Params.vnp_SecureHash;
        delete vnp_Params.transactionId;
        delete vnp_Params.vnp_SecureHashType;

        let signData = encodeData(vnp_Params);
        let signed = genHash(signData, this.settings.vnpayConfig.vnp_HashSecret);

        if (secureHash === signed) {
          return {code: vnp_Params.vnp_ResponseCode};
        } else {
          return {code: '97'};
        }
      },
    },
    ipnURL: {
      rest: 'GET /ipn',
      async handler(ctx) {
        try {
          const ips = ctx.meta.client_ip.split(',');
          const vnp_Params = sortObjectVnpay(ctx.params);
          const whitelist = this.settings.vnpayConfig.vnp_Whitelist.split(',');

          const secureHash = vnp_Params.vnp_SecureHash;
          delete vnp_Params.vnp_SecureHash;
          delete vnp_Params.transactionId;
          delete vnp_Params.vnp_SecureHashType;

          const signed = genHash(encodeData(vnp_Params), this.settings.vnpayConfig.vnp_HashSecret);
          const transaction = await VnpTransaction.findOne({txnRef: vnp_Params.vnp_TxnRef})
            .populate({path: 'paymentForId'});

          const checkIpValid = ips.some(ip => whitelist.includes(ip));
          if (!checkIpValid) return this.handleErrorPayment(ctx, transaction, "99", "Unknown error");

          if (!transaction) return this.handleErrorPayment(ctx, transaction, "01", "Order not found");
          if (secureHash !== signed) return this.handleErrorPayment(ctx, transaction, "97", "Fail checksum");
          if (transaction.amount * 100 !== Number(vnp_Params.vnp_Amount)) return this.handleErrorPayment(ctx, transaction, "04", "Invalid amount");
          if (transaction.status !== 0) return this.handleErrorPayment(ctx, transaction, "02", "Order already confirmed");

          const status = vnp_Params.vnp_ResponseCode === '00' || vnp_Params.vnp_TransactionStatus === '00' ? 1 : 2;
          const state = status === 1 ? 'done' : 'error';
          await VnpTransaction.findByIdAndUpdate(transaction._id, {status});
          await this.broker.emit("transactionUpdateState", {
            transactionId: transaction.transactionId.toString(),
            state,
            responseCode: vnp_Params.vnp_ResponseCode,
            responseMessage: vnp_Params.vnp_ResponseCode === '00' || vnp_Params.vnp_ResponseCode === '00' ? 'Confirm Success' : 'Confirm Fail',
          });

          await VnpLog.create({
            url: ctx?.options?.parentCtx?.params?.req?.originalUrl,
            ip: ctx.meta.client_ip,
            type: 2,
            responseCode: '00',
          })
          return {RspCode: '00', Message: 'Confirm Success'};

        } catch (error) {
          await VnpLog.create({
            url: ctx?.options?.parentCtx?.params?.req?.originalUrl,
            ip: ctx.meta.client_ip,
            type: 2,
            responseCode: '99',
          });
          return {RspCode: '99', Message: 'Unknown error'};
        }
      }
    },
  },
  methods: {
    async handleErrorPayment(ctx, transaction, rspCode, messase) {
      await this.broker.emit("transactionUpdateState", {
        transactionId: transaction?.transactionId?.toString(),
        state: "error",
        responseCode: rspCode,
        responseMessage: messase,
      });

      await VnpLog.create({
        url: ctx?.options?.parentCtx?.params?.req?.originalUrl,
        ip: ctx.meta.client_ip,
        type: 2,
        responseCode: rspCode,
      });

      return {RspCode: rspCode, Message: messase};
    }

  },
  events: {},
  created() {
  },

  /**
   * Service started lifecycle event handler
   */
  async started() {
  },

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {
  },

  async afterConnected() {

  },
};

function removeVietnameseTones(str) {
  return str.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

const formatDateVnpay = (date) => {
  return dayjs(date).format('YYYYMMDDHHmmss');
};

const sortObjectVnpay = (obj) => {
  let sorted = {};
  let str = [];
  let key;
  for (key in obj) {
    if (obj.hasOwnProperty(key)) {
      str.push(encodeURIComponent(key));
    }
  }
  str.sort();
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, '+');
  }
  return sorted;
};

const getTxnRefAndOrderInDay = () => {
  return `${dayjs().format('YYYYMMDD')}` + Math.random().toString(36).substr(2, 15);
};

const genHash = (data, hashSecret) => {
  const hmac = CryptoJS.HmacSHA512(data, hashSecret);
  return CryptoJS.enc.Hex.stringify(hmac);
};

const checkSum = (data, hashSecret, hash) => {
  const hashCheck = genHash(data, hashSecret);
  return hashCheck === hash;
};

function encodeData(data) {
  return qs.stringify(data, {encode: false});
}
