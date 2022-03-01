import {
  visitAsync,
  toJSX,
  CH_CODE_CONFIG_PLACEHOLDER,
} from "./unist-utils"
import { Node } from "unist"
import visit from "unist-util-visit"
import visitParents from "unist-util-visit-parents"
import { Parent } from "hast-util-to-estree"
import { highlight } from "@code-hike/highlighter"
import { EditorStep } from "@code-hike/mini-editor"
import { Code } from "@code-hike/utils"

export async function transformInlineCodes(
  tree: Node,
  { theme }: { theme: any }
) {
  // transform *`foo`* to <CH.InlineCode>foo</CH.InlineCode>
  visit(tree, "emphasis", (node: Parent) => {
    if (
      node.children &&
      node.children.length === 1 &&
      node.children[0].type === "inlineCode"
    ) {
      node.type = "mdxJsxTextElement"
      node.name = "CH.InlineCode"
      node.children = [
        { type: "text", value: node.children[0].value },
      ]
    }
  })

  await visitAsync(
    tree,
    ["mdxJsxFlowElement", "mdxJsxTextElement"],
    async (node: Parent) => {
      if (node.name === "CH.InlineCode") {
        const inlinedCode = node.children[0].value as string
        const lang = node.attributes?.lang

        toJSX(node, {
          props: {
            code: await getCode(
              tree,
              node,
              inlinedCode,
              lang,
              theme
            ),
            codeConfig: CH_CODE_CONFIG_PLACEHOLDER,
          },
          appendProps: true,
        })
      }
    }
  )
}

async function getCode(
  tree: Node,
  node: Parent,
  inlinedCode: string,
  lang: string | undefined,
  theme: any
) {
  const ancestors = getAncestors(tree, node)
  const sectionNode = ancestors.find(
    n => n.data?.editorStep
  )

  // if node isn't inside a section-like parent, use provided lang or "jsx"
  if (!sectionNode) {
    return await highlight({
      code: inlinedCode,
      lang: lang || "jsx",
      theme,
    })
  }

  const editorStep = sectionNode.data
    .editorStep as any as EditorStep

  // if the same code is present in the editor step, use it
  const existingCode = getExistingCode(
    editorStep.files,
    inlinedCode
  )

  if (existingCode) {
    return existingCode
  }

  // or else, try to guess the language from somewhere
  const activeFile =
    editorStep.files?.find(
      f => f.name === editorStep.northPanel?.active
    ) || editorStep.files[0]

  const activeLang = activeFile?.code?.lang

  return await highlight({
    code: inlinedCode,
    lang: lang || activeLang || "jsx",
    theme,
  })
}

function getAncestors(tree: Node, node: Node): Parent[] {
  let ancestors: Parent[] = []
  visitParents(tree, node, (node, nodeAncestors) => {
    ancestors = nodeAncestors
  })
  return ancestors
}

function getExistingCode(
  files: EditorStep["files"] | undefined,
  inlinedCode: string
): Code | undefined {
  if (!files) {
    return undefined
  }

  for (const file of files) {
    for (const line of file.code.lines) {
      const lineContent = line.tokens
        .map(t => t.content)
        .join("")
      const index = lineContent.indexOf(inlinedCode)
      if (index !== -1) {
        const tokens = sliceTokens(
          line,
          index,
          inlinedCode.length
        )
        return { lang: file.code.lang, lines: [{ tokens }] }
      }
    }
  }
  return undefined
}

function sliceTokens(
  line: Code["lines"][0],
  start: number,
  length: number
) {
  const tokens = line.tokens
  let currentLength = 0

  let headTokens = [] as Code["lines"][0]["tokens"]

  for (let i = 0; i < tokens.length; i++) {
    if (currentLength === start) {
      headTokens = tokens.slice(i)
      break
    }
    if (currentLength + tokens[i].content.length > start) {
      const newToken = {
        ...tokens[i],
        content: tokens[i].content.slice(
          start - currentLength
        ),
      }
      headTokens = [newToken].concat(tokens.slice(i + 1))
      break
    }
    currentLength += tokens[i].content.length
  }

  currentLength = 0
  for (let i = 0; i < headTokens.length; i++) {
    if (currentLength === length) {
      return headTokens.slice(0, i)
    }
    if (
      currentLength + headTokens[i].content.length >
      length
    ) {
      const newToken = {
        ...headTokens[i],
        content: headTokens[i].content.slice(
          0,
          length - currentLength
        ),
      }

      return headTokens.slice(0, i).concat([newToken])
    }
    currentLength += headTokens[i].content.length
  }
  return []
}
