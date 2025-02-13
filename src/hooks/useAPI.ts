import { Ref } from 'vue'
import type { ParsedEvent, ReconnectInterval } from "eventsource-parser"
import { createParser } from "eventsource-parser"
import { useSettings } from "@/hooks/useSettings"
import { Chat } from '@/typings/chat'
import type { SettingsState } from '@/store/modules/settings/helper'
import { useChat } from "@/hooks/useChat"
import { useRecord } from "@/hooks/useRecord"
import type { Record } from "@/store/modules/record/helper"
import type { AxiosProgressEvent, GenericAbortSignal } from 'axios'
import { getNowTime, generateUUID } from '@/utils/util'
import post from '@/utils/request'
import { fetchChatAPIProcess } from '@/api'
import { C } from '@tauri-apps/api/event-30ea0228'
const baseURL = 'https://api.openai.com'

interface GPTMessage {
    role: string,
    content: string
}

export interface GPTParam {
  question: string, 
  prompts: string, 
  apiKey: string,
}

export interface GPTParamV2 {
  question: string, 
  prompts?: string, // not use
  controller: AbortController,
  conversationID?: string,
  parentMessageId?: string,
}

export interface GPTResponse {
  content: string,
  newConversationId: string,
  newParentMessageId: string,
}

export async function askChatGPTIntegratorAPI(param: GPTParamV2, controller: AbortController, callback: Function, errorCallback: Function) {  
  const {updateSetting, getSetting} = useSettings()
  const setting = getSetting()
  const hasApiKey = (setting.apiKey && setting.apiKey !== '') ? true : false
  try{
    if(hasApiKey) {
      await askChatGPTCore(param, controller, callback, errorCallback)
    }else {
      await askChatGPTV2(param, callback, errorCallback)
    }
  }finally{
    controller.abort()
  }

}

export async function askChatGPTV2(param: GPTParamV2, callback: Function, errorCallback: Function) {
  let question = param.question.trim()
  let prompts: string = param.prompts ? param.prompts.trim() : ''
  if (prompts.length === 0 && (question === '\n' || question.length === 0)) {
    return
  }

  const {updateSetting, getSetting} = useSettings()
  const setting = getSetting()
  const apiKey = setting.apiKey
  const useChatContext = setting.useChatContext
  const userProxy = setting.proxy

  let options =	useChatContext ? {
    conversationId: setting.conversationRequest?.conversationId,
    parentMessageId: setting.conversationRequest?.parentMessageId
  } : {
      conversationId: '',
      parentMessageId: ''
  }

  if(apiKey.trim().length === 0) {
    question = prompts.trim().length === 0 ? question : prompts.trim() + '.' + question
  }

  try {
    const {newConversationId, newParentMessageId} = await fetchChatAPIOnceV2(question, prompts, apiKey, userProxy, param.controller, options, callback, errorCallback)
    if(useChatContext && newConversationId && newParentMessageId && (newConversationId !== '' || newParentMessageId !== '')) {
        updateSetting({
          systemMessage: setting.systemMessage,
          language: setting.language,
          apiKey: setting.apiKey,
          proxy: setting.proxy,
          isDarkMode: setting.isDarkMode,
          useChatContext: setting.useChatContext,
          conversationRequest: {
            conversationId: newConversationId,
            parentMessageId: newParentMessageId
          }
        })
    }
  }catch(error: any) {
    console.log(error)
    errorCallback(error)
  }
}

// 文本对话 检查指令/image 生成图片
async function fetchChatAPIOnceV2(question: string, prompt: string, apiKey: string, userProxy: string, controller: AbortController, options: Chat.ConversationRequest, callback: Function, errorCallback: Function){
  let newConversationId: string = options.conversationId ? options.conversationId : ''
  let newParentMessageId: string = options.parentMessageId ? options.parentMessageId : ''
  await fetchChatAPIProcess<Chat.ConversationResponse>({
    question: question,
    prompt: prompt,
    options,
    apiKey: apiKey,
    userProxy: userProxy,
    signal: controller.signal,
    onDownloadProgress: ({ event }) => {
      console.log('event', event)
      const xhr = event.target
      const { responseText } = xhr
      console.log('responseText', responseText)
      // Always process the final line
      const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
      let chunk = responseText
      if (lastIndex !== -1)
        chunk = responseText.substring(lastIndex)
      console.log(chunk)
      try {
        const data = JSON.parse(chunk)
        if(data.status === null || data.status === "Fail" || !data.parentMessageId || data.parentMessageId === '') {
          errorCallback(data.message)
          return
        }
        newConversationId = data.id
        newParentMessageId = data.parentMessageId
        let content = data.text
        console.log('content: ', content)
        let response: GPTResponse =  {
          content: content,
          newConversationId: newConversationId, 
          newParentMessageId: newParentMessageId,
        }
        callback(response)
      }catch (error) {
        console.log(error)
        errorCallback(error)
      }
    },
  })
  return {newConversationId, newParentMessageId}
}

const OPEN_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const URL_PROXY = import.meta.env.VITE_URL_PROXY;

// App组件调用方来传参 如何不用Ref做参数也能做到传进一个响应式对象, 目前的实现是把Result和loading都写进来了
  export async function askChatGPTCore(param: GPTParamV2, controller: AbortController, callback: Function, errorCallback: Function) {  
    let question = param.question.trim()
    let prompts: string = param.prompts ? param.prompts.trim() : ''
    if (prompts.length === 0 && (question === '\n' || question.length === 0)) {
      return
    }
  
    const {updateSetting, getSetting} = useSettings()
    const setting = getSetting()
    const apiKey = (setting.apiKey && setting.apiKey !== '') ?  setting.apiKey : OPEN_API_KEY
    const useChatContext = setting.useChatContext
    let userProxy = (setting.proxy && setting.proxy !== '') ? setting.proxy : URL_PROXY

    if (!apiKey) {
      throw new Error("请在设置页面中, 填写OpenAI API key; 内测版免费无需API Key, 请加QQ交流群456730400下载")
    }

    if (!userProxy) {
      userProxy = baseURL
    }

    let options =	useChatContext ? {
      conversationId: param.conversationID,
      parentMessageId: param.parentMessageId
    } : {
        conversationId: '',
        parentMessageId: ''
    }

    console.log('options id', options.conversationId)
  
    if(apiKey.trim().length === 0) {
      question = prompts.trim().length === 0 ? question : prompts.trim() + '.' + question
    }
  
    try {
      let response = await askChatGPTAPI(param, controller, options, useChatContext, apiKey, userProxy)
      if (!response.ok) {
          const res = await response.json()
          errorCallback(res.error.message)
          throw new Error(res.error.message)
      }
      const data = response.body
      if (!data) {
          errorCallback("没有返回数据")
          throw new Error("没有返回数据")
      }
      const reader = data.getReader()
      const decoder = new TextDecoder("utf-8")
      let done = false

      let newConversationId: null | string = null
      let newParentMessageId: null | string = null
      let result = ''
      while (!done) {
          const { value, done: readerDone } = await reader.read()
          if (value) {
              let decodedData = decoder.decode(value)
              try {
                const gptResponse: GPTResponse = JSON.parse(decodedData);
                // 根据GPTResponse渲染相应内容
                if (gptResponse.content === "\n" && result.endsWith("\n")) {
                  continue
                }
                if (gptResponse.content) {
                    newConversationId = gptResponse.newConversationId
                    newParentMessageId = gptResponse.newParentMessageId
                    result = result + gptResponse.content
                    let callbackResponse: GPTResponse = {
                      content: result,
                      newConversationId,
                      newParentMessageId,
                    }
                    console.log(callbackResponse)
                    callback(callbackResponse)
                }
              } catch (e) {
                console.error(e);
                errorCallback(e);
                return
              }
          }
          done = readerDone
      }

      if(useChatContext && newConversationId && newParentMessageId) {
          console.log('update Setting, create conversation', newConversationId)
          updateSetting({
            conversationRequest: {
              conversationId: newConversationId===null ? options.conversationId: newConversationId,
              parentMessageId: newParentMessageId===null ? options.parentMessageId : newParentMessageId,
            }
          })
          const { addRecordMessage }  = useRecord()
          let userMessage: Record = {
            dateTime: getNowTime(),
            text: question,
            bot: false,
            conversationOptions: {
              conversationId: newConversationId,
              parentMessageId: newParentMessageId,
            }
          }
          addRecordMessage(newConversationId, userMessage)
          let botMessage: Record = {
            dateTime: getNowTime(),
            text: result,
            bot: true,
            conversationOptions: {
              conversationId: newConversationId,
              parentMessageId: newParentMessageId,
            }
          }
          addRecordMessage(newConversationId, botMessage)
      }
    }catch(error: any) {
      console.log(error)
      errorCallback(error)
    }
}

function parseNumber(numStr: string): number {
  const numRegex = /^\d+$/;
  if (!numRegex.test(numStr)) {
    console.error(`输入的 "${numStr}" 不是有效的数字`);
    return NaN; // 或者返回默认值
  }
  return parseInt(numStr, 10);
}

async function askChatGPTAPI(messages: GPTParamV2, controller: AbortController, options: Chat.ConversationRequest, useChatContext: boolean, apiKey: string, user_proxy: string) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    if (!apiKey) {
      throw new Error("请在设置页面中, 填写OpenAI API key; 内测版免费无需API Key, 请加交流群456730400下载")
    }

    let proxyUrl: null | string = null
    if (user_proxy) {
      proxyUrl = user_proxy
      if (!/^https?:\/\//i.test(proxyUrl)) {
        proxyUrl = `https://${proxyUrl}/v1/chat/completions`;
      } else {
        proxyUrl = `${proxyUrl}/v1/chat/completions`;
      }
    }
    let url = `https://${baseURL}/v1/chat/completions`
    let gptMessage: GPTMessage[] = []

    let chatId = options.conversationId
    console.log('useChatContext', useChatContext)
    console.log('chatId', chatId)
    if (useChatContext && chatId!==null && chatId!==undefined && chatId.length > 0) {
      console.log('useChatContext, getRecord,', chatId, chatId)
      const { getRecordMessages } = useRecord()
      let chatMessages = getRecordMessages(chatId)
      console.log('chatMessages', chatMessages)
      if(chatMessages) {
        for (const message of chatMessages) {
          const role = message.bot === true ? 'assistant' : 'user';
          gptMessage.push({
              role: role,
              content: message.text
          });
        }
      }
    }

    if(messages.prompts) {
      gptMessage.push(
        {
          role: 'system',
          content: messages.prompts ? messages.prompts : '',
        }
      )
    }
    const systemMessageOffset = gptMessage.length
    gptMessage.push({
      role: 'user',
      content: messages.question,
    })

    console.log('gptMessage', gptMessage)


    let newChatID: null | number = null
    console.log(chatId)
    if(chatId) {
      console.log('chatId is immutable', chatId)
      newChatID = chatId
    }else {
      console.log('gen uuid')
      newChatID = generateUUID()
    }

    const requestOptions = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      method: "POST",
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: gptMessage,
        stream: true,
      }),
      signal: controller.signal,
    }

    let apiRequest;
    if (!proxyUrl) { // 如果代理服务器不存在，则直接发送请求
      console.log('not have proxyUrl')
      apiRequest = fetch(url, requestOptions);
    } else { // 否则，设置代理服务器参数并发送请求
      console.log('set host')
      apiRequest = fetch(proxyUrl, {
        ...requestOptions,
        headers: {
          ...requestOptions.headers,
          Host: baseURL
        },
      })
    }

    const rawRes = await apiRequest.catch(err => {
      return new Response(
        JSON.stringify({
          error: {
            message: err.message
          }
        }),
        { status: 500 }
      )
    })

    if (!rawRes.ok) {
      return new Response(rawRes.body, {
        status: rawRes.status,
        statusText: rawRes.statusText
      })
    }

    const stream = new ReadableStream({
      async start(controller) {
        const streamParser = (event: ParsedEvent | ReconnectInterval) => {
          if (event.type === "event") {
            const data = event.data
            if (data === "[DONE]") {
              controller.close()
              return
            }
            try {
              console.log('data')
              console.log(data)
              const json = JSON.parse(data)
              const text = json.choices[0].delta?.content
              let newMessageId = json.id
              let content = text
              let response: GPTResponse =  {
                content: content,
                newConversationId: newChatID, 
                newParentMessageId: newMessageId,
              }
              // 编码GPT响应，并将其加入控制器队列
              const encodedChunk = new TextEncoder().encode(
                JSON.stringify(response)
              );
              controller.enqueue(encodedChunk)
            } catch (e) {
              controller.error(e)
            }
          }
        }
        const parser = createParser(streamParser)

        // chrome not support async iterator, so manually read iterator
        async function readAllChunks(readableStream: any) {
          const reader = readableStream.getReader();
          
          let done, value;
          while (!done) {
            ({ value, done } = await reader.read());
            if (done) {
              return;
            }
            parser.feed(decoder.decode(value))
          }
        }

        await readAllChunks(rawRes.body)
      }
    })

    return new Response(stream) 
}

export function fetchChatConfig<T = any>() {
  return post<T>({
    url: '/config',
  })
}

export function fetchSession<T>() {
  return post<T>({
    url: '/session',
  })
}

export function fetchVerify<T>(token: string) {
  return post<T>({
    url: '/verify',
    data: { token },
  })
}