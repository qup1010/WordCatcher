import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkgPath = resolve(process.cwd(), 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const currentVersion = pkg.version || '0.1.0'

const args = process.argv.slice(2)
const autoPush = args.includes('--push')
const versionArg = args.find(arg => !arg.startsWith('--')) || 'patch'

function getNextVersion(current, type) {
  const parts = current.split('.').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`无法解析当前版本号: ${current}`)
  }

  let [major, minor, patch] = parts

  if (type === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (type === 'minor') {
    minor += 1
    patch = 0
  } else if (type === 'patch') {
    patch += 1
  } else if (/^\d+\.\d+\.\d+$/.test(type)) {
    return type
  } else {
    throw new Error(`无效的版本参数: ${type} (支持: patch | minor | major | x.y.z)`)
  }

  return `${major}.${minor}.${patch}`
}

const nextVersion = getNextVersion(currentVersion, versionArg)
const tagName = `v${nextVersion}`

console.log(`\n📦 准备发布新版本: ${currentVersion} → ${nextVersion} (${tagName})\n`)

function run(cmd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit' })
}

try {
  // 1. 运行测试
  console.log('🧪 运行自动化测试...')
  run('pnpm test')

  // 2. 验证构建
  console.log('\n🔨 验证构建打包...')
  run('pnpm build')

  // 3. 更新 package.json
  console.log(`\n📝 更新 package.json 版本为 ${nextVersion}...`)
  pkg.version = nextVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')

  // 4. Git 提交与打 Tag
  console.log('\n🔖 提交 Git 变更并创建 Tag...')
  run('git add .')
  run(`git commit -m "chore(release): ${tagName}"`)
  run(`git tag ${tagName}`)

  console.log(`\n✅ 版本 ${tagName} 创建成功！`)

  if (autoPush) {
    console.log('\n🚀 正在推送到 GitHub 远程仓库...')
    run('git push origin main')
    run(`git push origin ${tagName}`)
    console.log(`\n🎉 发布推送完成！GitHub Actions 将自动开始构建与发布 Release。`)
  } else {
    console.log('\n💡 运行以下命令推送到远程以触发 GitHub Actions 自动发布：')
    console.log(`   git push origin main && git push origin ${tagName}\n`)
  }
} catch (err) {
  console.error('\n❌ 发布流程中断:', err.message)
  process.exit(1)
}
