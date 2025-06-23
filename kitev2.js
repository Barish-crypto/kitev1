const fs = require('fs').promises;
const axios = require('axios');
const crypto = require('crypto');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  switch (type) {
    case 'success':
      console.log(`[${timestamp}] [✓] ${msg}`.green);
      break;
    case 'custom':
      console.log(`[${timestamp}] [*] ${msg}`.magenta);
      break;
    case 'error':
      console.log(`[${timestamp}] [✗] ${msg}`.red);
      break;
    case 'warning':
      console.log(`[${timestamp}] [!] ${msg}`.yellow);
      break;
    default:
      console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
  }
}

async function countdown(seconds) {
  for (let i = seconds; i > 0; i--) {
    const timestamp = new Date().toLocaleTimeString();
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
}

const API_KEY = 'CAP-2A8D4A1FED4798DF321DA0CFE00BCF34'; // Replace with your CapSolver API key
const SITE_KEY = '6Lc_VwgrAAAAALtx_UtYQnW-cFg8EPDgJ8QVqkaz';
const PAGE_URL = 'https://testnet.gokite.ai/';

function getCommonHeaders(userAgent, additionalHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
    'Origin': 'https://testnet.gokite.ai',
    'Referer': 'https://testnet.gokite.ai/',
    'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'User-Agent': userAgent,
    ...additionalHeaders,
  };
}

async function makeRequest(method, url, data = {}, access_token = null, userAgent, customHeaders = {}, responseType = 'json') {
  const maxRetries = 10;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const headers = getCommonHeaders(userAgent, {
        ...(access_token && { 'Authorization': `Bearer ${access_token}` }),
        ...customHeaders,
      });

      const config = {
        method,
        url,
        timeout: 120000,
        headers,
        responseType,
        ...(method.toLowerCase() === 'post' && { data }),
      };

      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (error.message.includes('504')) {
        log(`Lỗi 504 khi gọi ${url} (lần thử ${attempt}/${maxRetries}): ${error.message}`, 'error');
        if (attempt === maxRetries) {
          throw new Error(`Đã thử ${maxRetries} lần nhưng không gọi được ${url}: ${error.message}`);
        }
        log(`Thử lại sau 5 giây...`, 'warning');
        await countdown(5);
        attempt++;
      } else {
        throw new Error(
          `${error.message}${error.response ? ` - ${JSON.stringify(error.response.data)}` : ''}`
        );
      }
    }
  }
}

async function solveCaptcha(userAgent) {
  try {
    log('Bắt đầu giải captcha...', 'custom');

    let taskConfig = {
      type: 'ReCaptchaV2TaskProxyLess',
      websiteURL: PAGE_URL,
      websiteKey: SITE_KEY,
      isInvisible: false,
      userAgent: userAgent,
      cookies: [],
    };

    const payload = {
      clientKey: API_KEY,
      task: taskConfig,
    };

    const createTaskResponse = await axios.post('https://api.capsolver.com/createTask', payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (createTaskResponse.data.errorId !== 0) {
      throw new Error(`Error creating task: ${createTaskResponse.data.errorDescription || 'Unknown error'} (Error ID: ${createTaskResponse.data.errorId})`);
    }

    const taskId = createTaskResponse.data.taskId;
    log(`Task ID: ${taskId}. Đang chờ kết quả...`, 'info');

    let solution = null;
    let waitTime = 3000;
    const maxAttempts = 20;

    for (let i = 0; i < maxAttempts; i++) {
      await countdown(3);

      const resultResponse = await axios.post(
        'https://api.capsolver.com/getTaskResult',
        {
          clientKey: API_KEY,
          taskId: taskId,
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      );

      if (resultResponse.data.errorId === 0) {
        if (resultResponse.data.status === 'ready') {
          solution = resultResponse.data.solution;
          log('Giải captcha thành công!', 'success');
          break;
        } else if (resultResponse.data.status === 'failed') {
          throw new Error('Giải captcha không thành công!');
        } else {
          log(`Nhiệm vụ chưa sẵn sàng, đang thử lại sau ${waitTime / 1000}s...`, 'info');
        }
      } else {
        throw new Error(`Lỗi khi lấy kết quả: ${resultResponse.data.errorDescription || 'Unknown error'} (Error ID: ${resultResponse.data.errorId})`);
      }

      waitTime = Math.min(waitTime + 1000, 10000);
    }

    if (!solution) {
      throw new Error('Hết thời gian, không nhận được giải pháp');
    }

    return { data: solution.gRecaptchaResponse };
  } catch (error) {
    log(`solveCaptcha error: ${error.message}`, 'error');
    if (error.response) {
      log(`CapSolver response: ${JSON.stringify(error.response.data)}`, 'error');
    }
    return { error: error.message };
  }
}

function hexToBuffer(hexString) {
  let bytes = [];
  for (let i = 0; i < hexString.length; i += 2) {
    bytes.push(parseInt(hexString.substr(i, 2), 16));
  }
  return Buffer.from(bytes);
}

function bytesToHex(bytes) {
  let hexChars = [];
  for (let i = 0; i < bytes.length; i++) {
    let value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hexChars.push((value >>> 4).toString(16));
    hexChars.push((15 & value).toString(16));
  }
  return hexChars.join("");
}

async function encrypt(
  address,
  keyHex = "6a1c35292b7c5b769ff47d89a17e7bc4f0adfe1b462981d28e0e9f7ff20b8f8a"
) {
  const keyBuffer = hexToBuffer(keyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  let encrypted = cipher.update(address, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  const result = Buffer.concat([iv, encrypted, authTag]);
  return bytesToHex(result);
}

async function generateAuthToken(address) {
  return await encrypt(address);
}

async function getUserProfile(eoa, aa_address, access_token, userAgent) {
  try {
    const data = await makeRequest('get', 'https://ozone-point-system.prod.gokite.ai/me', {}, access_token, userAgent);
    log(`Total XP Points: ${data.data.profile.total_xp_points}`, 'info');
    return data.data;
  } catch (error) {
    if (error.message.includes('401') && error.message.includes('User does not exist')) {
      log('User does not exist, attempting to register...', 'warning');
      const authData = await makeRequest(
        'post',
        'https://ozone-point-system.prod.gokite.ai/auth',
        {
          registration_type_id: 1,
          user_account_id: "",
          user_account_name: "",
          eoa_address: eoa,
          smart_account_address: aa_address,
          referral_code: "RXP1I1N2",
        },
        access_token,
        userAgent
      );
      log(`Đăng ký thành công! Tổng số điểm XP: ${authData.data.profile.total_xp_points}`, 'success');
      return authData.data;
    }
    throw error;
  }
}

async function getOnboardingQuiz(eoa, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'get',
      `https://neo.prod.gokite.ai/v2/quiz/onboard/get?eoa=${eoa}`,
      {},
      access_token,
      userAgent
    );
    return data.data;
  } catch (error) {
    throw new Error(`Lỗi rồi: ${error.message}`);
  }
}

async function submitQuizAnswer(question_id, answer, finish, eoa, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'post',
      'https://neo.prod.gokite.ai/v2/quiz/onboard/submit',
      { question_id, answer, finish, eoa },
      access_token,
      userAgent
    );
    log(`Đã nộp câu trả lời bài kiểm tra tân thủ ${question_id}: ${data.data.result}`, 'success');
    return data.data;
  } catch (error) {
    throw new Error(`Lỗi khi gửi câu trả lời cho bài kiểm tra ${question_id}: ${error.message}`);
  }
}

async function processOnboardingQuiz(eoa, access_token, userAgent) {
  try {
    const quizData = await getOnboardingQuiz(eoa, access_token, userAgent);;
    const questions = quizData.question;
    if (!questions || questions.length === 0) {
      throw new Error('No onboarding quiz questions found in response');
    }

    const answers = questions.map((question, index) => ({
      question_id: question.question_id,
      answer: question.answer,
      finish: index === questions.length - 1,
    }));

    for (let i = 0; i < answers.length; i++) {
      const { question_id, answer, finish } = answers[i];
      log(`Nộp câu trả lời bài kiểm tra tân thủ ${question_id} với đáp án ${answer}...`, 'custom');
      await submitQuizAnswer(question_id, answer, finish, eoa, access_token, userAgent);
      if (i < answers.length - 1) {
        await countdown(3);
      }
    }

    log('Onboarding quiz completed!', 'success');
  } catch (error) {
    log(`Lỗi rồi: ${error.message}`, 'error');
  }
}

async function createDailyQuiz(eoa, access_token, userAgent) {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const quizDate = yesterday.toISOString().split('T')[0];
    const quizTitle = `daily_quiz_${quizDate}`;

    const data = await makeRequest(
      'post',
      'https://neo.prod.gokite.ai/v2/quiz/create',
      { title: quizTitle, num: 1, eoa },
      access_token,
      userAgent
    );

    log(`Đã tạo bài kiểm tra hàng ngày với ID: ${data.data.quiz_id}`, 'success');
    return data.data.quiz_id;
  } catch (error) {
    throw new Error(`Lỗi rồi: ${error.message}`);
  }
}

async function getDailyQuiz(quiz_id, eoa, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'get',
      `https://neo.prod.gokite.ai/v2/quiz/get?id=${quiz_id}&eoa=${eoa}`,
      {},
      access_token,
      userAgent
    );
    return data.data;
  } catch (error) {
    throw new Error(`Lỗi rồi: ${error.message}`);
  }
}

async function submitDailyQuizAnswer(quiz_id, question_id, answer, eoa, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'post',
      'https://neo.prod.gokite.ai/v2/quiz/submit',
      { quiz_id, question_id, answer, finish: true, eoa },
      access_token,
      userAgent
    );
    log(`Đã nộp câu trả lời trắc nghiệm hàng ngày cho câu hỏi ${question_id}: ${data.data.result}`, 'success');
    log('Đã làm xong quiz hàng ngày', 'success');
    return data.data;
  } catch (error) {
    throw new Error(`Error submitting daily quiz answer for question ${question_id}: ${error.message}`);
  }
}

async function processDailyQuiz(eoa, access_token, userAgent) {
  try {
    log('Tạo bài kiểm tra hàng ngày...', 'custom');
    const quiz_id = await createDailyQuiz(eoa, access_token, userAgent);
    log('Lấy câu hỏi trắc nghiệm hàng ngày...', 'custom');
    const quizData = await getDailyQuiz(quiz_id, eoa, access_token, userAgent);
    const questions = quizData.question;
    if (!questions || questions.length === 0) {
      throw new Error('Không tìm thấy quiz nào');
    }

    const question = questions[0];
    log(`Nộp câu trả lời trắc nghiệm hàng ngày cho câu hỏi ${question.question_id} với đáp án ${question.answer}...`, 'custom');
    await submitDailyQuizAnswer(quiz_id, question.question_id, question.answer, eoa, access_token, userAgent);
    log('Đã hoàn thành bài kiểm tra hàng ngày!', 'success');
  } catch (error) {
    log(`Lỗi xử lý bài kiểm tra hàng ngày: ${error.message}`, 'error');
  }
}

async function claimFaucet(eoa, access_token, userAgent) {
  const maxRetries = 30;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const captchaResult = await solveCaptcha(userAgent);
      if (captchaResult.error) {
        throw new Error(`Không giải được captcha: ${captchaResult.error}`);
      }

      const recaptchaToken = captchaResult.data;
      log(`Lần thử ${attempt}/${maxRetries}: Claiming...`, 'custom');

      const data = await makeRequest(
        'post',
        'https://ozone-point-system.prod.gokite.ai/blockchain/faucet-transfer',
        {},
        access_token,
        userAgent,
        { 'X-Recaptcha-Token': recaptchaToken }
      );

      log(`Faucet thành công KITE sau ${attempt} lần thử!`, 'success');
      return data;
    } catch (error) {
      if (error.message.includes('400') && error.message.includes('Already claimed today')) {
        log('Hôm nay bạn đã faucet KITE rồi.', 'info');
        return null;
      }

      log(`Thử lại ${attempt}/${maxRetries}: Lỗi faucet: ${error.message}`, 'error');
      if (attempt === maxRetries) {
        log(`Đã đạt đến số lần thử lại tối đa (${maxRetries}). Bỏ cuộc.`, 'error');
        return null;
      }

      log(`Thử faucet lại sau 10 giây...`, 'warning');
      await countdown(10);
      attempt++;
    }
  }
}

async function getBalance(eoa, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'get',
      'https://ozone-point-system.prod.gokite.ai/me/balance',
      {},
      access_token,
      userAgent
    );
    log(`Balance - KITE: ${data.data.balances.kite}, USDT: ${data.data.balances.usdt}`, 'info');
    return data.data.balances;
  } catch (error) {
    throw new Error(`Không lấy được balance KITE: ${error.message}`);
  }
}

async function getSubnets(access_token, userAgent) {
  try {
    const data = await makeRequest(
      'get',
      'https://ozone-point-system.prod.gokite.ai/subnets?page=1&size=100',
      {},
      access_token,
      userAgent
    );
    const subnets = data.data;
    if (!subnets || subnets.length === 0) {
      throw new Error('No subnets found in response');
    }

    const bitmindSubnet = subnets.find(subnet => subnet.name.toLowerCase() === 'bitmind' && subnet.address === '0xc368ae279275f80125284d16d292b650ecbbff8d');
    
    if (!bitmindSubnet) {
      throw new Error('Subnet BitMind not found in response');
    }

    log(`Đã chọn BitMind với APR ${bitmindSubnet.current_apr}%`, 'success');
    return bitmindSubnet;
  } catch (error) {
    throw new Error(`Lỗi khi lấy danh sách subnets: ${error.message}`);
  }
}

async function stakeKite(subnet_address, amount, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'post',
      'https://ozone-point-system.prod.gokite.ai/subnet/delegate',
      { subnet_address, amount },
      access_token,
      userAgent
    );
    log(`Stake thành công, tổng bạn đã stake ${data.data.my_staked_amount} KITE`, 'success');

    if (data.data.my_staked_amount >= 2) {
      try {
        const claimResponse = await makeRequest(
          'post',
          'https://ozone-point-system.prod.gokite.ai/subnet/claim-rewards',
          { subnet_address },
          access_token,
          userAgent
        );
        log(
          `Claim phần thưởng stake thành công: ${claimResponse.data.claim_amount} | tx: ${claimResponse.data.tx_hash}`,
          'success'
        );
      } catch (error) {
        log(`Lỗi khi claim phần thưởng: ${error.message}`, 'error');
      }
    } else {
      log(`Tổng số lượng stake (${data.data.my_staked_amount} KITE)`, 'info');
    }

    return data.data;
  } catch (error) {
    throw new Error(`Lỗi staking KITE: ${error.message}`);
  }
}

async function getBadges(access_token, userAgent) {
  const maxRetries = 10;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const data = await makeRequest(
        'get',
        'https://ozone-point-system.prod.gokite.ai/badges',
        {},
        access_token,
        userAgent
      );
      log(`Tìm thấy ${data.data.length} huy hiệu`, 'info');
      return data.data;
    } catch (error) {
      log(`Lỗi khi lấy danh sách huy hiệu (lần thử ${attempt}/${maxRetries}): ${error.message}`, 'error');
      if (attempt === maxRetries) {
        throw new Error(`Đã thử ${maxRetries} lần nhưng không lấy được danh sách huy hiệu: ${error.message}`);
      }
      log(`Thử lại sau 5 giây...`, 'warning');
      await countdown(5);
      attempt++;
    }
  }
}

async function mintBadge(badge_id, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'post',
      'https://ozone-point-system.prod.gokite.ai/badges/mint',
      { badge_id },
      access_token,
      userAgent
    );
    log(`Đúc huy hiệu thành công (Badge ID: ${data.data.badge_id}, Token ID: ${data.data.token_id})`, 'success');
    return data.data;
  } catch (error) {
    log(`Lỗi chi tiết khi đúc huy hiệu ${badge_id}: ${error.message}`, 'error');
    throw error;
  }
}

async function callInference(message, service_id, subnet, access_token, userAgent) {
  try {
    const data = await makeRequest(
      'post',
      'https://ozone-point-system.prod.gokite.ai/agent/inference',
      {
        service_id,
        subnet,
        stream: true,
        body: { stream: true, message },
      },
      access_token,
      userAgent,
      { 'Accept': 'text/event-stream' },
      'stream'
    );

    let fullResponse = '';
    await new Promise((resolve, reject) => {
      data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.replace('data: ', ''));
              if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                fullResponse += parsed.choices[0].delta.content;
              }
            } catch (error) {
            }
          }
        }
      });

      data.on('end', () => {
        log(`Đã nhận được phản hồi từ câu hỏi "${message}": ${fullResponse}`, 'info');
        resolve(fullResponse);
      });

      data.on('error', (error) => {
        reject(new Error(`Stream error: ${error.message}`));
      });
    });

    return fullResponse;
  } catch (error) {
    throw new Error(`Lỗi rồi: ${error.message}`);
  }
}

async function submitReceipt(aa_address, service_id, input_message, output_message, access_token, userAgent) {
  const maxRetries = 5;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const data = await makeRequest(
        'post',
        'https://neo.prod.gokite.ai/v2/submit_receipt',
        {
          address: aa_address,
          service_id,
          input: [{ type: 'text/plain', value: input_message }],
          output: [{ type: 'text/plain', value: output_message }],
        },
        access_token,
        userAgent
      );
      log('Tương tác được ghi nhận thành công', 'success');
      return data.data;
    } catch (error) {
      log(`Lỗi khi ghi lại tương tác (lần thử ${attempt}/${maxRetries}): ${error.message}`, 'error');
      if (attempt === maxRetries) {
        throw new Error(`Đã thử ${maxRetries} lần nhưng không ghi lại được tương tác: ${error.message}`);
      }
      log(`Thử lại sau 5 giây...`, 'warning');
      await countdown(5);
      attempt++;
    }
  }
}

async function getSmartAccountAddress(eoa, userAgent) {
  try {
    const headers = getCommonHeaders(userAgent, {
      'Content-Type': 'application/json',
      'Accept': '*/*',
    });

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          data: `0x8cb84e18000000000000000000000000${eoa.slice(2).toLowerCase()}4b6f5b36bb7706150b17e2eecb6e602b1b90b94a4bf355df57466626a5cb897b`,
          to: '0x948f52524Bdf595b439e7ca78620A8f843612df3',
        },
        'latest',
      ],
    };

    const response = await axios.post('https://rpc-testnet.gokite.ai/', payload, {
      timeout: 60000,
      headers,
    });

    if (response.data.result) {
      const aa_address = `0x${response.data.result.slice(26)}`;
      log(`Đã lấy được smart address: ${aa_address}`, 'info');
      return aa_address;
    } else {
      throw new Error('No smart account address returned in eth_call response');
    }
  } catch (error) {
    throw new Error(`Failed to retrieve smart account address: ${error.message}`);
  }
}

function getRandomQuestion(questions) {
  return questions[Math.floor(Math.random() * questions.length)];
}

async function checkAgentActions(access_token, userAgent) {
  try {
    const data = await makeRequest(
      'get',
      'https://ozone-point-system.prod.gokite.ai/me/actions?page=1&size=100',
      {},
      access_token,
      userAgent
    );

    const today = DateTime.now().setZone('UTC').startOf('day');
    const actions = data.data.actions || [];

    const agentAction = actions.find(action => {
      const actionTime = DateTime.fromISO(action.timestamp, { zone: 'UTC' });
      return (
        action.actionType === 'Points for agent actions today' &&
        action.xpPoints === 300 &&
        actionTime.hasSame(today, 'day')
      );
    });

    if (agentAction) {
      log('Đã chơi với AI xong..nhận 300 xpPoints', 'success');
      return true;
    }
    return false;
  } catch (error) {
    log(`Lỗi khi kiểm tra agent actions: ${error.message}`, 'error');
    return false;
  }
}

async function processAgentInteractions(eoa, aa_address, access_token, userAgent) {
  try {
    const hasAgentPoints = await checkAgentActions(access_token, userAgent);
    if (hasAgentPoints) {
      log('Hôm nay bạn đã chơi với AI đủ rồi', 'info');
      return;
    }

    log('Chơi với AI nào...', 'custom');

    const questions = {
      'deployment_MJX99ReRJ0PViYQ89xB0jcbI': [
        'What are the key benefits of using Kite AI for developers?',
        'How does Kite AI enhance productivity in coding projects?',
        'What new tools has Kite AI recently introduced?',
        'How does Kite AI compare to other AI coding assistants?',
        'Can Kite AI assist with debugging complex code?',
        'What are the core AI algorithms behind Kite AI\'s functionality?',
        'Which IDEs are best supported by Kite AI?',
        'How can Kite AI help with learning new programming languages?',
        'What are some tips for getting the most out of Kite AI?',
        'How does Kite AI ensure code quality in its suggestions?',
        'What are the most innovative features of Kite AI?',
        'How user-friendly is the Kite AI interface?',
        'Does Kite AI offer any real-time collaboration tools?',
        'What security measures does Kite AI implement?',
        'How does Kite AI adapt to different coding styles?',
        'What are the future plans for Kite AI development?',
        'Can Kite AI integrate with version control systems?',
        'What feedback mechanisms are available in Kite AI?',
        'How does Kite AI handle large codebases?',
        'What is the learning curve for mastering Kite AI?',
        'How do updates affect existing Kite AI installations?',
        'Can Kite AI be used for mobile development projects?',
        'What are the licensing terms for Kite AI?',
        'How does Kite AI manage different programming environments?',
        'Is there a community or forum for Kite AI users?',
        'What are the most common use cases of Kite AI?',
        'How does Kite AI support code refactoring?',
        'Are there any training resources for Kite AI?',
        'What are the limitations of using Kite AI?',
        'How does Kite AI integrate machine learning in its processes?',
        'What are the key benefits of using Kite AI for developers?',
        'How does Kite AI enhance productivity in coding projects?',
        'What new tools has Kite AI recently introduced?',
        'How does Kite AI compare to other AI coding assistants?',
        'Can Kite AI assist with debugging complex code?',
        'What are the core AI algorithms behind Kite AI\'s functionality?',
        'Which IDEs are best supported by Kite AI?',
        'How can Kite AI help with learning new programming languages?',
        'What are some tips for getting the most out of Kite AI?',
        'How does Kite AI ensure code quality in its suggestions?',
        'What are the most innovative features of Kite AI?',
        'How user-friendly is the Kite AI interface?',
        'Does Kite AI offer any real-time collaboration tools?',
        'What security measures does Kite AI implement?',
        'How does Kite AI adapt to different coding styles?',
        'What are the future plans for Kite AI development?',
        'Can Kite AI integrate with version control systems?',
        'What feedback mechanisms are available in Kite AI?',
        'How does Kite AI handle large codebases?',
        'What is the learning curve for mastering Kite AI?',
        'How do updates affect existing Kite AI installations?',
        'Can Kite AI be used for mobile development projects?',
        'What are the licensing terms for Kite AI?',
        'How is trust ensured in marketplace transactions?',
        'Is the marketplace open to the public?',
        'Can third-party developers use the marketplace?',
        'What token does Kite AI use?',
        'How are tokens earned in the ecosystem?',
        'Are there staking opportunities on Kite AI?',
        'How does token distribution support ecosystem growth?',
        'Can tokens be used to access premium services?',
        'How does Kite AI protect user privacy?',
        'Is data encrypted on the platform?',
        'What measures prevent model plagiarism?',
        'How is misuse of AI agents handled?',
        'Does Kite AI comply with data regulations?',
        'How can developers contribute to Kite AI?',
        'Is there a grant program for contributors?',
        'Are there community governance features?',
        'What kind of support does Kite offer for builders?',
        'Is there a testnet available?',
        'What are the main use cases for Kite AI?',
        'How can enterprises benefit from Kite AI?',
        'Is Kite AI integrated with other blockchain platforms?',
        'What are the roadmap goals for Kite AI?',
        'How can I start using Kite AI today?',
        'What is Kite AI?',
        'What is proof of AI?',
        'Who are the main participants in the Kite AI ecosystem?',
        'What makes Kite AI different from other AI platforms?',
        'Is Kite AI centralized or decentralized?',
        'What is a Layer-1 blockchain in the context of Kite AI?',
        'What is the role of subnets in Kite AI?',
        'How are subnets customized in Kite AI?',
        'What kind of smart contracts does Kite AI support?',
        'How does Kite AI manage scalability?',
        'What does PoAI stand for?',
        'How does PoAI work in Kite AI?',
        'Why is PoAI important for fair attribution?',
        'What types of contributions are tracked by PoAI?',
        'How are rewards distributed in the PoAI system?',
        'Who can upload data in the Kite ecosystem?',
        'How is data ownership protected on Kite AI?',
        'Are AI models stored on-chain or off-chain?',
        'Can models be monetized on Kite AI?',
        'How are model creators rewarded?',
        'What is an AI agent in Kite AI?',
        'Can agents interact with each other?',
        'How are AI agents deployed on the platform?',
        'What tasks can agents perform?',
        'Are AI agents open-source or proprietary?',
        'What is the Kite AI marketplace?',
        'What can users buy or sell in the marketplace?',
        'How is trust ensured in marketplace transactions?',
        'Is the marketplace open to the public?',
        'Can third-party developers use the marketplace?',
        'What token does Kite AI use?',
        'How are tokens earned in the ecosystem?',
        'Are there staking opportunities on Kite AI?',
        'How does token distribution support ecosystem growth?',
        'Can tokens be used to access premium services?',
        'How does Kite AI protect user privacy?',
        'Is data encrypted on the platform?',
        'What measures prevent model plagiarism?',
        'How is misuse of AI agents handled?',
        'Does Kite AI comply with data regulations?',
        'How can developers contribute to Kite AI?',
        'Is there a grant program for contributors?',
        'Are there community governance features?',
        'What kind of support does Kite offer for builders?'
      ],
      'deployment_nXOmSXjGYfDOCO6iHSw9GKRk': [
        'What is the short-term price trend for Ethereum?',
        'How is the market reacting to recent Bitcoin news?',
        'Which cryptocurrencies are currently undervalued?',
        'What are the key factors driving Solana\'s price today?',
        'Provide a price forecast for Polkadot this week.',
        'How does Chainlink\'s performance compare to other altcoins?',
        'What are the recent market trends for Cardano?',
        'Analyze the volatility of Avalanche in the last 24 hours.',
        'What news is impacting the price of Polygon?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of Bitcoin?',
        'How does the price of Ethereum affect the price of other altcoins?',
        'What is the current market capitalization of Solana?',
        'How does the price of Polkadot compare to other smart contract platforms?',
        'What are the most undervalued cryptocurrencies in the market?',
        'Analyze the market sentiment for the top 10 cryptocurrencies.',
        'Which cryptocurrencies have the highest trading volume?',
        'What are the recent price movements of BNB?',
        'How does the price of BNB affect the price of other cryptocurrencies?',
        'What are the major drivers behind the price of Chainlink?',
        'How does the price of Chainlink compare to other oracle platforms?',
        'What are the recent market trends for Uniswap?',
        'Analyze the volatility of Uniswap in the last 24 hours.',
        'What news is impacting the price of Uniswap?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of Cardano?',
        'How does the price of Cardano compare to other proof-of-stake platforms?',
        'What are the recent market trends for Cosmos?',
        'Analyze the volatility of Cosmos in the last 24 hours.',
        'What news is impacting the price of Cosmos?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of Stellar?',
        'How does the price of Stellar compare to other decentralized exchange platforms?',
        'What are the recent market trends for EOS?',
        'Analyze the volatility of EOS in the last 24 hours.',
        'What news is impacting the price of EOS?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of Monero?',
        'How does the price of Monero compare to other privacy coins?',
        'What are the recent market trends for TRON?',
        'Analyze the volatility of TRON in the last 24 hours.',
        'What news is impacting the price of TRON?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of NEO?',
        'How does the price of NEO compare to other smart contract platforms?',
        'What are the recent market trends for Bitcoin Cash?',
        'Analyze the volatility of Bitcoin Cash in the last 24 hours.',
        'What news is impacting the price of Bitcoin Cash?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of Litecoin?',
        'How does the price of Litecoin compare to other proof-of-work platforms?',
        'What are the recent market trends for VeChain?',
        'Analyze the volatility of VeChain in the last 24 hours.',
        'What news is impacting the price of VeChain?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of Dogecoin?',
        'How does the price of Dogecoin compare to other meme coins?',
        'What are the recent market trends for Shiba Inu?',
        'Analyze the volatility of Shiba Inu in the last 24 hours.',
        'What news is impacting the price of Shiba Inu?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of ApeCoin?',
        'How does the price of ApeCoin compare to other gaming tokens?',
        'What are the recent market trends for Gala?',
        'Analyze the volatility of Gala in the last 24 hours.',
        'What news is impacting the price of Gala?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of THETA?',
        'How does the price of THETA compare to other video streaming platforms?',
        'What are the recent market trends for ICP?',
        'Analyze the volatility of ICP in the last 24 hours.',
        'What news is impacting the price of ICP?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of FIL?',
        'How does the price of FIL compare to other decentralized storage platforms?',
        'What are the recent market trends for EOS?',
        'Analyze the volatility of EOS in the last 24 hours.',
        'What news is impacting the price of EOS?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of XTZ?',
        'How does the price of XTZ compare to other proof-of-stake platforms?',
        'What are the recent market trends for ZIL?',
        'Analyze the volatility of ZIL in the last 24 hours.',
        'What news is impacting the price of ZIL?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of WAVES?',
        'How does the price of WAVES compare to other decentralized exchange platforms?',
        'What are the recent market trends for KSM?',
        'Analyze the volatility of KSM in the last 24 hours.',
        'What news is impacting the price of KSM?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of DASH?',
        'How does the price of DASH compare to other privacy coins?',
        'What are the recent market trends for NEO?',
        'Analyze the volatility of NEO in the last 24 hours.',
        'What news is impacting the price of NEO?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of XMR?',
        'How does the price of XMR compare to other privacy coins?',
        'What are the recent market trends for IOTA?',
        'Analyze the volatility of IOTA in the last 24 hours.',
        'What news is impacting the price of IOTA?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of EGLD?',
        'How does the price of EGLD compare to other proof-of-stake platforms?',
        'What are the recent market trends for COMP?',
        'Analyze the volatility of COMP in the last 24 hours.',
        'What news is impacting the price of COMP?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of SNX?',
        'How does the price of SNX compare to other decentralized lending platforms?',
        'What are the recent market trends for RUNE?',
        'Analyze the volatility of RUNE in the last 24 hours.',
        'What news is impacting the price of RUNE?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of MKR?',
        'How does the price of MKR compare to other stablecoins?',
        'What are the recent market trends for CRV?',
        'Analyze the volatility of CRV in the last 24 hours.',
        'What news is impacting the price of CRV?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of YFI?',
        'How does the price of YFI compare to other decentralized lending platforms?',
        'What are the recent market trends for KAVA?',
        'Analyze the volatility of KAVA in the last 24 hours.',
        'What news is impacting the price of KAVA?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of BAND?',
        'How does the price of BAND compare to other decentralized oracles?',
        'What are the recent market trends for NEXO?',
        'Analyze the volatility of NEXO in the last 24 hours.',
        'What news is impacting the price of NEXO?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of OXT?',
        'How does the price of OXT compare to other decentralized lending platforms?',
        'What are the recent market trends for LEND?',
        'Analyze the volatility of LEND in the last 24 hours.',
        'What news is impacting the price of LEND?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of GNO?',
        'How does the price of GNO compare to other decentralized oracles?',
        'What are the recent market trends for MLN?',
        'Analyze the volatility of MLN in the last 24 hours.',
        'What news is impacting the price of MLN?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of BZRX?',
        'How does the price of BZRX compare to other decentralized lending platforms?',
        'What are the recent market trends for LDO?',
        'Analyze the volatility of LDO in the last 24 hours.',
        'What news is impacting the price of LDO?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of TRB?',
        'How does the price of TRB compare to other decentralized lending platforms?',
        'What are the recent market trends for CRV?',
        'Analyze the volatility of CRV in the last 24 hours.',
        'What news is impacting the price of CRV?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of UNI?',
        'How does the price of UNI compare to other decentralized exchange platforms?',
        'What are the recent market trends for AAVE?',
        'Analyze the volatility of AAVE in the last 24 hours.',
        'What news is impacting the price of AAVE?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of YFI?',
        'How does the price of YFI compare to other decentralized lending platforms?',
        'What are the recent market trends for KAVA?',
        'Analyze the volatility of KAVA in the last 24 hours.',
        'What news is impacting the price of KAVA?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of BAND?',
        'How does the price of BAND compare to other decentralized oracles?',
        'What are the recent market trends for NEXO?',
        'Analyze the volatility of NEXO in the last 24 hours.',
        'What news is impacting the price of NEXO?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of OXT?',
        'How does the price of OXT compare to other decentralized lending platforms?',
        'What are the recent market trends for LEND?',
        'Analyze the volatility of LEND in the last 24 hours.',
        'What news is impacting the price of LEND?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of GNO?',
        'How does the price of GNO compare to other decentralized oracles?',
        'What are the recent market trends for MLN?',
        'Analyze the volatility of MLN in the last 24 hours.',
        'What news is impacting the price of MLN?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of APT?',
        'How does the price of APT compare to other decentralized lending platforms?',
        'What are the recent market trends for UST?',
        'Analyze the volatility of UST in the last 24 hours.',
        'What news is impacting the price of UST?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of MIM?',
        'How does the price of MIM compare to other decentralized lending platforms?',
        'What are the recent market trends for FRAX?',
        'Analyze the volatility of FRAX in the last 24 hours.',
        'What news is impacting the price of FRAX?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of FEI?',
        'How does the price of FEI compare to other decentralized lending platforms?',
        'What are the recent market trends for REN?',
        'Analyze the volatility of REN in the last 24 hours.',
        'What news is impacting the price of REN?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of SNX?',
        'How does the price of SNX compare to other decentralized lending platforms?',
        'What are the recent market trends for LUSD?',
        'Analyze the volatility of LUSD in the last 24 hours.',
        'What news is impacting the price of LUSD?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of TUSD?',
        'How does the price of TUSD compare to other decentralized lending platforms?',
        'What are the recent market trends for USDT?',
        'Analyze the volatility of USDT in the last 24 hours.',
        'What news is impacting the price of USDT?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of USDC?',
        'How does the price of USDC compare to other decentralized lending platforms?',
        'What are the recent market trends for DAI?',
        'Analyze the volatility of DAI in the last 24 hours.',
        'What news is impacting the price of DAI?',
        'Which top cryptocurrencies are showing bearish signals?',
        'What are the major drivers behind the price of WBTC?',
        'How does the price of WBTC compare to other decentralized lending platforms?',
        'What are the recent market trends for WETH?',
        'Analyze the volatility of WETH in the last 24 hours.',
        'What news is impacting the price of WETH?',
        'Which top cryptocurrencies are showing bullish signals?',
        'What are the major drivers behind the price of LINK?',
        'How does the price of LINK compare to other decentralized oracles?',
        'What are the recent market trends for COMP?',
        'Analyze the volatility of COMP in the last 24 hours.',
        'What news is impacting the price of COMP?',
        'Which top cryptocurrencies are showing bearish signals?',
      ]
    };

    const services = [
      { service_id: 'deployment_MJX99ReRJ0PViYQ89xB0jcbI', subnet: 'kite_ai_labs' },
      { service_id: 'deployment_nXOmSXjGYfDOCO6iHSw9GKRk', subnet: 'kite_ai_labs' }
    ];

    let interactionCount = 0;
    const targetInteractions = 150;

    while (interactionCount < targetInteractions) {
      const hasAgentPoints = await checkAgentActions(access_token, userAgent);
      if (hasAgentPoints) {
        break;
      }

      for (let i = 0; i < 15 && interactionCount < targetInteractions; i++) {
        const service = services[Math.floor(Math.random() * services.length)];
        const message = getRandomQuestion(questions[service.service_id]);

        log(`Gửi tin nhắn (${interactionCount + 1}/${targetInteractions}): ${message}`, 'custom');
        const inferenceResponse = await callInference(message, service.service_id, service.subnet, access_token, userAgent);
        log(`Đang ghi lại tương tác: ${message}`, 'custom');
        await submitReceipt(aa_address, service.service_id, message, inferenceResponse, access_token, userAgent);
        interactionCount++;
        await countdown(2);
      }

      if (interactionCount < targetInteractions) {
        log('Chưa nhận được 300 xpPoints, kiểm tra lại sau 15 lần chat...', 'warning');
        await countdown(5);
      }
    }

    const finalCheck = await checkAgentActions(access_token, userAgent);
    if (!finalCheck) {
      log('Đã thực hiện đủ 31 lần tương tác nhưng không nhận được 300 xpPoints.', 'warning');
    }

  } catch (error) {
    log(`Lỗi khi xử lý tương tác với AI: ${error.message}`, 'error');
  }
}

async function processWallets() {
  try {
    const walletData = await fs.readFile('wallet.txt', 'utf8');
    const wallets = walletData.split('\n').filter(line => line.trim() !== '');

    const agentData = await fs.readFile('agent.txt', 'utf8');
    const userAgents = agentData.split('\n').filter(line => line.trim() !== '');

    log(`Tìm thấy ${wallets.length} ví và ${userAgents.length} user agent`, 'info');

    if (wallets.length !== userAgents.length) {
      log('Số lượng user agent không khớp với số lượng ví. Sẽ sử dụng user agent mặc định cho các ví thiếu.', 'warning');
    }

    for (let i = 0; i < wallets.length; i++) {
      const eoa = wallets[i].trim();
      const userAgent = userAgents[i] ? userAgents[i].trim() : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

      if (!eoa.startsWith('0x') || eoa.length !== 42) {
        log(`Địa chỉ ví không hợp lệ: ${eoa}`, 'error');
        continue;
      }

      try {
        log(`Bắt đầu xử lý ví ${i + 1}/${wallets.length}: ${eoa}`, 'custom');

        log(`Đang tìm kiếm smart contract: ${eoa}`, 'custom');
        const aa_address = await getSmartAccountAddress(eoa, userAgent);

        const authToken = await generateAuthToken(eoa);

        let signinResponse;
        let signinAttempts = 0;
        const maxSigninAttempts = 10;

        while (signinAttempts < maxSigninAttempts) {
          try {
            signinResponse = await makeRequest(
              'post',
              'https://neo.prod.gokite.ai/v2/signin',
              { eoa, aa_address },
              null,
              userAgent,
              { 'Authorization': authToken, 'Accept': '*/*' }
            );
            break;
          } catch (error) {
            if (
              error.message.includes('500') &&
              error.message.includes('signin v2 approve settlement: replacement transaction underpriced')
            ) {
              signinAttempts++;
              log(
                `Thử lại đăng nhập lần ${signinAttempts}/${maxSigninAttempts} cho ví ${eoa}: ${error.message}`,
                'warning'
              );
              if (signinAttempts < maxSigninAttempts) {
                log(`Chờ 3 giây trước khi thử lại...`, 'info');
                await countdown(3);
              } else {
                throw new Error(
                  `Đã thử ${maxSigninAttempts} lần đăng nhập cho ví ${eoa} nhưng thất bại: ${error.message}`
                );
              }
            } else {
              throw error;
            }
          }
        }

        const { access_token } = signinResponse.data;
        log(`Đăng nhập thành công!`, 'success');
        log(`Ví: ${eoa}`, 'info');
        log(`Access Token: ${access_token}`, 'info');
        log(`Smart Account Address: ${aa_address}`, 'info');

        const profileData = await getUserProfile(eoa, aa_address, access_token, userAgent);

        if (!profileData.onboarding_quiz_completed) {
          log('Onboarding quiz not completed, processing quiz...', 'warning');
          await processOnboardingQuiz(eoa, access_token, userAgent);
        } else {
          log('Onboarding quiz already completed.', 'info');
        }

        if (!profileData.daily_quiz_completed) {
          log('Đang làm quiz hôm nay...', 'warning');
          await processDailyQuiz(eoa, access_token, userAgent);
        } else {
          log('Đã làm quiz hôm nay.', 'info');
        }

        if (profileData.faucet_claimable) {
          log('Faucet mở, lấy KITE...', 'warning');
          await claimFaucet(eoa, access_token, userAgent);
        }
        await countdown(10);
        const balance = await getBalance(eoa, access_token, userAgent);
        if (balance.kite >= 1) {
          log('KITE balance >= 1, tiến hành staking...', 'warning');
          const highestAprSubnet = await getSubnets(access_token, userAgent);
          await stakeKite(highestAprSubnet.address, 1, access_token, userAgent);
        } else {
          log('KITE không có sẵn, bỏ qua staking.', 'info');
        }

        log('Kiểm tra huy hiệu có sẵn...', 'custom');
        const badges = await getBadges(access_token, userAgent);
        const mintedBadgeIds = Array.isArray(profileData.profile.badges_minted)
          ? profileData.profile.badges_minted.map(badge => badge.id)
          : [];
        const eligibleBadges = badges.filter(
          badge => badge.isPublicMint && badge.isEligible && !mintedBadgeIds.includes(badge.collectionId)
        );

        if (eligibleBadges.length > 0) {
          log(`Tìm thấy ${eligibleBadges.length} huy hiệu đủ điều kiện để đúc`, 'info');
          for (const badge of eligibleBadges) {
            log(`Đang đúc huy hiệu: ${badge.name} (ID: ${badge.collectionId})`, 'custom');
            await mintBadge(badge.collectionId, access_token, userAgent);
            await countdown(2);
          }
        } else {
          log('Không có huy hiệu đủ điều kiện để đúc hoặc tất cả huy hiệu đủ điều kiện đã được đúc.', 'info');
        }

        await processAgentInteractions(eoa, aa_address, access_token, userAgent);

        log('------------------------', 'custom');

        if (i < wallets.length - 1) {
          await countdown(2);
        }
      } catch (error) {
        log(`Lỗi xử lý ví ${eoa}:`, 'error');
        log(`General error: ${error.message}`, 'error');
        log(`Tiếp tục với ví tiếp theo...`, 'warning');
        continue;
      }
    }

    log('Xong :)))', 'success');
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (error.path.includes('wallet.txt')) {
        log('Lỗi: không tìm thấy file wallet.txt!', 'error');
      } else if (error.path.includes('agent.txt')) {
        log('Lỗi: không tìm thấy file agent.txt!', 'error');
      }
    } else {
      log(`Lỗi không mong muốn: ${error.message}`, 'error');
    }
  }
}

log('Dân Cày Airdrop...', 'custom');
processWallets();