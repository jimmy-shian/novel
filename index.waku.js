// //(function() {
// window.onload = function() {
  //   //=================================================== 複製gmail
// // 選取所有具有 class "myButton" 的按鈕
// var buttons = document.querySelectorAll(".copy-p-button");
// // var ytspeed = document.querySelectorAll(".ytspeed");
// console.log('email:');
// // 為每個文字節點綁定 click 事件
// var textNodes = document.querySelectorAll(".span-copy");

// textNodes.forEach(function(textNode) {
//   textNode.addEventListener("click", function() {
//     var text = this.textContent.trim(); // 取得文字節點的文字內容
//     copyText(text, this.nextElementSibling);
//   });
// });
// // 為每個按鈕綁定 click 事件
// buttons.forEach(function(button) {
//     button.addEventListener("click", function() {
//         var text = this.previousElementSibling.textContent.trim(); // 取得前一個節點的文字內容
//         copyText(text, this);
//     });
// });

// function copyText(text, button) {
//     navigator.clipboard.writeText(text).then(function() {
//         if (button) {
//             button.textContent = ' ✓ Copied !'; // 修改按鈕文字為 "複製成功"
//             setTimeout(function() {
//                 button.textContent = 'Copy'; // 2秒後將按鈕文字改回 "Copy"
//             }, 800);      
//         }
//         console.log(text);
//     }).catch(function(err) {
//         // window.alert("複製失敗", err);
//         console.error('複製失敗', err);
//     });
// }
// //===================================================
// };
/*
$(document).ready(function () {
  // 創建外層容器
  const outSidePanelContainer = $('<div>', {
      class: 'out_side_panel_container'
  });

  // 創建側邊面板容器
  const sidePanelContainer = $('<div>', {
      id: 'side_panel_container',
      class: 'side_panel_container'
  });

  // 創建側邊面板切換按鈕
  const sidePanelToggle = $('<div>', {
      id: 'side_panel_toggle',
      class: 'side_panel_toggle',
      html: '&#9654;' // 向右的三角形符號
  });

  // 創建表單
  const sidePanelForm = $('<form>', {
      class: 'side_panel_form'
  });

  // 創建查詢和儲存按鈕容器
  const changeSaveQueryPlace = $('<div>', {
      class: 'change_save_quert_place'
  });

  // 創建查詢按鈕
  const queryButton = $('<button>', {
      type: 'button',
      id: 'query_button',
      text: '查詢章節'
  });

  // 創建儲存按鈕
  const saveButton = $('<button>', {
      type: 'button',
      id: 'save_button',
      text: '儲存章節'
  });

  // 將查詢和儲存按鈕添加到容器
  changeSaveQueryPlace.append(queryButton, saveButton);

  // 創建帳號輸入框
  const userInput = $('<input>', {
      type: 'text',
      id: 'user',
      placeholder: '帳號',
      class: 'side_panel_input',
      //value: 'jimmy'
  });

  // 創建密碼輸入框和顯示密碼按鈕容器
  const mimaPlace = $('<div>', {
      class: 'mima_place'
  });

  // 創建密碼輸入框
  const passwordInput = $('<input>', {
      type: 'password',
      id: 'password',
      placeholder: '密碼',
      class: 'side_panel_input',
      //value: '123'
  });

  // 創建顯示密碼按鈕
  const togglePasswordButton = $('<button>', {
      type: 'button',
      id: 'toggle_password',
      click: function () {
          togglePasswordVisibility(); // 呼叫顯示/隱藏密碼的函數
      }
  }).append($('<img>', {
      src: 'https://jimmy-shian.github.io/novel/picture/show_password.png',
      alt: '顯示密碼',
      id: 'password_icon'
  }));

  // 將密碼輸入框和顯示按鈕添加到密碼容器
  mimaPlace.append(passwordInput, togglePasswordButton);

  // 創建章節和訊息輸入框
  const chapterInput = $('<input>', {
      type: 'text',
      id: 'chapter',
      placeholder: '書名',
      class: 'side_panel_input',
      value: 'ch1'
  });

  const messageInput = $('<input>', {
      type: 'text',
      id: 'message',
      placeholder: '章節',
      class: 'side_panel_input'
  });

  // 創建提交按鈕
  const submitButton = $('<button>', {
      type: 'submit',
      class: 'side_panel_submit',
      id: 'submit_button',
      text: '儲存'
  });

  // 將所有元素添加到表單中
  sidePanelForm.append(
      changeSaveQueryPlace,
      userInput,
      mimaPlace,
      chapterInput,
      messageInput,
      submitButton
  );

  // 將側邊面板切換按鈕和表單添加到側邊面板容器中
  sidePanelContainer.append(sidePanelToggle, sidePanelForm);

  // 將側邊面板容器添加到外層容器
  outSidePanelContainer.append(sidePanelContainer);

  // 創建覆蓋層
  const overlay = $('<div>', {
      id: 'overlay',
      class: 'overlay'
  });

  // 將外層容器和覆蓋層添加到 body
  $('body').append(outSidePanelContainer, overlay);
  const sidePanelContainer_js = document.getElementById('side_panel_container');
  const sidePanelToggle_js = document.getElementById('side_panel_toggle');
  const overlay_js = document.getElementById('overlay');

  // 切換側邊欄顯示狀態
  function toggleSidePanel() {
      const isOpen_js = sidePanelContainer_js.classList.contains('open');
      if (isOpen_js) {
          sidePanelContainer_js.classList.remove('open');
          overlay_js.classList.remove('active');
          sidePanelToggle_js.innerHTML = '&#9654;'; // 展開箭頭
      } else {
          sidePanelContainer_js.classList.add('open');
          overlay_js.classList.add('active');
          sidePanelToggle_js.innerHTML = '&#9664;'; // 收回箭頭
      }
  }

  // 點擊箭頭按鈕切換側邊欄
  sidePanelToggle_js.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidePanel();
  });

  // 點擊空白處縮回側邊欄
  overlay_js.addEventListener('click', toggleSidePanel);

  function togglePasswordVisibility() {
      const passwordField_js = document.getElementById('password');
      const passwordIcon_js = document.getElementById('password_icon');

      if (passwordField_js.type === 'password') {
          passwordField_js.type = 'text';
          passwordIcon_js.src = 'https://jimmy-shian.github.io/novel/picture/hide_password.png'; // 切換為「隱藏密碼」圖片
          passwordIcon_js.alt = '隱藏密碼';
      } else {
          passwordField_js.type = 'password';
          passwordIcon_js.src = 'https://jimmy-shian.github.io/novel/picture/show_password.png'; // 切換為「顯示密碼」圖片
          passwordIcon_js.alt = '顯示密碼';
      }
  }

  const submitButton_js = document.getElementById('submit_button');
  const chapterInput_js = document.getElementById('message');

  // 記錄當前模式
  let currentMode_js = 'save';

  $('#query_button').on('click', function () {
      submitButton_js.textContent = '查詢';
      chapterInput_js.disabled = true; // 禁止輸入

      currentMode_js = 'query';
      //toggleFormMode(currentMode);
  });

  $('#save_button').on('click', function () {
      submitButton_js.textContent = '儲存';
      chapterInput_js.disabled = false; // 儲存模式允許輸入

      currentMode_js = 'save';
      //toggleFormMode(currentMode);
  });

  $('#submit_button').on('click', function (event) {
      event.preventDefault(); // 阻止表單的預設提交行為
      // 檢查按鈕的文字內容
      if (submitButton_js.textContent === "前往") {
          // 跳轉到 YouTube
          const inputNumber_js = $('#message').val().trim();
          const bookTitle_js = $('#chapter').val().trim();
          if (/^\d+$/.test(inputNumber_js)) {
            // 構造新的URL並重新定向網頁
            const newUrl = `${bookTitle_js}_html${inputNumber_js}.html`;
            // 檢查新的 URL 是否存在
            fetch(newUrl)
            .then(response => {
              if (response.ok) {
                // URL 存在，重新定向網頁到該 URL
                window.location.href = newUrl;
              } else {
                alert('輸入章節錯誤，請重新輸入');
                // URL 不存在，重新整理頁面
                window.location.reload();
              }
            })
            .catch(error => {
              console.error('發生錯誤:', error);
              // alert('輸入章節錯誤，請重新輸入');
              // 重新整理頁面
              window.location.reload();
            });
            // window.location.href = newUrl;
          } else {
            // 彈出提示框
            alert('輸入章節錯誤，請重新輸入');
            // 在當前頁面重新整理
            window.location.reload();
            // window.location.href = 'https://jimmy-shian.github.io/novel/404.html';
          }

      } else {
          // 如果不是「前往」，則執行查詢或儲存操作
          toggleFormMode(currentMode_js);
      }
  });

  function toggleFormMode(mode) {
      var url_js = 'https://script.google.com/macros/s/AKfycbwfajf6Lv4_r4wdcbswpxMFtLtxjp6ZxWZ9RI_FLvmf7oIAlY_rILxgmC5zQeRtDRJ6/exec';
      var user_js = $('#user').val().trim();
      var password_js = $('#password').val().trim();
      var chapter_js = $('#chapter').val().trim();
      var message_js = $('#message').val().trim();
      if (message_js == '0' || message_js == '') {
        // 如果 message_js 是 '0' 或空值，保持輸入框是空值
        $('#message').val(''); // 可以選擇性地設置輸入框為空
       }

      // 檢查必填欄位
      if (!user_js || !password_js || !chapter_js) {
          alert('請填寫帳號、密碼和書名！'); // 提示用戶填寫必要的欄位
          return; // 資料不完整，禁止執行後續操作
      }

      // 在儲存模式下，檢查 message 是否有數值
      if (mode === 'save' && !message_js) {
          alert('請填寫章節！'); // 提示用戶填寫章節
          return; // 資料不完整，禁止執行後續操作
      }

      if (mode === 'query') {
          let dotCount_js = 0; // 點點計數器
          chapterInput_js.value = "查詢中";

          // 啟動點點動畫，每500毫秒切換一次
          const animationInterval_js = setInterval(() => {
              dotCount_js = (dotCount_js + 1) % 4; // 計算點點數量(0,1,2,3循環)
              chapterInput_js.value = "查詢中" + ".".repeat(dotCount_js); // 更新input內容
          }, 500);

          $.get(url_js, {
                  user: user_js,
                  password: password_js,
                  chapter: chapter_js
              },
              function (data) {
                  if (data.status == 'success') {
                      clearInterval(animationInterval_js); // 停止動畫
                      chapterInput_js.value = data.message; // 查詢成功後顯示訊息
                      submitButton_js.textContent = '前往';
                  } else if (data.status == 'error') {
                      clearInterval(animationInterval_js); // 停止動畫
                      chapterInput_js.value = data.message; // 清除查詢中的文字
                      submitButton_js.textContent = '查詢';
                  }
              }
          ).fail(function (error) {
              alert(`${error.message}`);
          });

      } else if (mode === 'save') {
          // 禁用按鈕，並添加抖動效果
          submitButton_js.disabled = true;
          submitButton_js.classList.add('shake');
          submitButton_js.textContent = '儲存中';

          $.post(url_js, {
                  user: user_js,
                  password: password_js,
                  chapter: chapter_js,
                  msg: message_js
              },
              function (data) {
                  if (data.status == 'success') {
                      alert(`${user_js} save "${message_js}" successfully`);
                  } else if (data.status == 'error') {
                      alert(`!!~ ${data.message}`);
                  }
                  submitButton_js.textContent = '儲存';
                  // 移除抖動效果並重新啟用按鈕
                  submitButton_js.classList.remove('shake');
                  submitButton_js.disabled = false;
              }
          ).fail(function (error) {
              // 當請求失敗時，移除抖動效果並重新啟用按鈕
              submitButton_js.textContent = '儲存';
              alert(`!!~ ${error.message}`);
              submitButton_js.classList.remove('shake');
              submitButton_js.disabled = false;
          });
      }
  }

});
*/
// 書名和拼音的字典
const bookDictionary = {
  "百鍊成仙": "bailianchengxian-huanyu",
  "滄元圖": "cangyuantu-wochixihongshi",
  "大奉打更人": "dafengdagengren-maibaoxiaolangjun",
  "大符篆師": "dafuzhuanshi-xiaodaofengli",
  "帝霸": "diba-yanbixiaosheng",
  "鬥破蒼穹": "doupocangqiong-tiancantudou",
  "凡人修仙傳": "fanrenxiuxianchuan-wangyu",
  "凡人修仙之仙界篇": "fanrenxiuxianzhixianjiepian-wangyu",
  "飛劍問道": "feijianwendao-wochixihongshi",
  "魔天記": "motianji-wangyu",
  "牧龍師": "mulongshi-luan",
  "求魔": "qiumo-ergen",
  "全職法師": "quanzhifashi-luan",
  //"關於轉世到史萊姆": "regarding-reincarnated-to-slime",
  "三寸人間": "sancunrenjian-ergen",
  "聖墟": "shengxu-chendong",
  "吞噬星空": "tunshixingkong-wochixihongshi",
  "我師兄實在太穩健了": "woshixiongshizaitaiwenjianle-yanguizhengzhuan",
  "我欲封天": "woyufengtian-ergen",
  "仙逆": "xianni-ergen",
  "星門": "xingmen-laoyingchixiaoji",
  "修真聊天群日常生活": "xiuzhenliaotianqunliaotianqunderichangshenghuo-shengqishidechuanshuo",
  "玄界之門": "xuanjiezhimen-wangyu",
  "一念永恆": "yinianyongheng-ergen"
};

// 函數：隨機選擇 5 到 7 個書名
function getRandomBookTitles(dictionary, count) {
  const keys = Object.keys(dictionary);
  const shuffled = keys.sort(() => 0.5 - Math.random()); // 隨機排序
  return shuffled.slice(0, count); // 返回前 count 個元素
}

  // 創建外層容器
  const outSidePanelContainer = $('<div>', {
    class: 'out_side_panel_container'
});

// 創建側邊面板容器
const sidePanelContainer = $('<div>', {
    id: 'side_panel_container',
    class: 'side_panel_container'
});

// 創建側邊面板切換按鈕
const sidePanelToggle = $('<div>', {
    id: 'side_panel_toggle',
    class: 'side_panel_toggle',
    html: String.fromCodePoint(0x1F87A) // 向右的三角形符號
});

// 創建表單
const sidePanelForm = $('<form>', {
    class: 'side_panel_form'
});

// 創建查詢和儲存按鈕容器
const changeSaveQueryPlace = $('<div>', {
    class: 'change_save_quert_place'
});

// 創建查詢按鈕
const queryButton = $('<button>', {
    type: 'button',
    id: 'query_button',
    text: '查詢章節'
});

// 創建儲存按鈕
const saveButton = $('<button>', {
    type: 'button',
    id: 'save_button',
    text: '儲存章節'
});

// 將查詢和儲存按鈕添加到容器
changeSaveQueryPlace.append(queryButton, saveButton);

// 創建帳號輸入框
const userInput = $('<input>', {
    type: 'text',
    id: 'user',
    placeholder: '帳號',
    class: 'side_panel_input',
    autocomplete: "username"
    //value: 'jimmy'
});

// 創建密碼輸入框和顯示密碼按鈕容器
const mimaPlace = $('<div>', {
    class: 'mima_place'
});

// 創建密碼輸入框
const passwordInput = $('<input>', {
    type: 'password',
    id: 'password',
    placeholder: '密碼',
    class: 'side_panel_input',
    autocomplete: "current-password"
    //value: '123'
});

// 創建顯示密碼按鈕
const togglePasswordButton = $('<button>', {
    type: 'button',
    id: 'toggle_password',
    click: function () {
        togglePasswordVisibility(); // 呼叫顯示/隱藏密碼的函數
    }
}).append($('<img>', {
    src: 'https://jimmy-shian.github.io/novel/picture/show_password.png',
    alt: '顯示密碼',
    id: 'password_icon'
}));

// 將密碼輸入框和顯示按鈕添加到密碼容器
mimaPlace.append(passwordInput, togglePasswordButton);

// 創建章節和訊息輸入框
const chapterInput = $('<input>', {
    type: 'text',
    id: 'chapter',
    placeholder: '書名',
    class: 'side_panel_input',
    //value: 'ch1'
});

const messageInput = $('<input>', {
    type: 'text',
    id: 'message',
    placeholder: '章節',
    class: 'side_panel_input'
});

// 創建提交按鈕
const submitButton = $('<button>', {
    type: 'submit',
    class: 'side_panel_submit',
    id: 'submit_button',
    text: '儲存'
});

// 將所有元素添加到表單中
sidePanelForm.append(
    changeSaveQueryPlace,
    userInput,
    mimaPlace,
    chapterInput,
    messageInput,
    submitButton
);

// 將側邊面板切換按鈕和表單添加到側邊面板容器中
sidePanelContainer.append(sidePanelToggle, sidePanelForm);

// 將側邊面板容器添加到外層容器
outSidePanelContainer.append(sidePanelContainer);

// 創建覆蓋層
const overlay = $('<div>', {
    id: 'overlay',
    class: 'overlay'
});

// 將外層容器和覆蓋層添加到 body
$('body').append(outSidePanelContainer, overlay);

    function checkScrollbar() {
      var body = document.body;
      var html = document.documentElement;
      var hasScrollbar = body.scrollHeight > html.clientHeight;
      var overflowStyle = window.getComputedStyle(body).overflowY;
    
      if (overflowStyle === 'scroll') {
        console.log('The webpage has a scrollbar.');
      } else {
        alert('The webpage does not have a scrollbar.');
        location.reload();
      }
    }
    checkScrollbar();
    // function scrollDown() {
    //   const currentPosition = window.pageYOffset;
    //   const targetPosition = currentPosition + 200;
    //   window.scrollTo(0, targetPosition);
    // }
    
    // setInterval(scrollDown, 4500);
  // 在這裡編寫你的全部程式碼

   // 翻譯index
    const cardText = document.querySelector('#cardText');
    const changeBtn = document.querySelector('#changeBtn');
    console.log(`changeBtn = ${changeBtn}`);
    console.log(`cardText = ${cardText}`);

   if (cardText !== 'null') {}

   let isChanged = '0';
           
       changeBtn?.addEventListener('click', function changeindextex() {
           if (isChanged === '0') {
           changeBtn.innerHTML = `Translate to English
           `;
           cardText.innerHTML = `
           <h4 class="card-title">進入網路小說世界~</h4>
           
           看啊，一個新的平台到來了，<br>
           虛構的故事正在努力，<br>
           娛樂和迷住思想，<br>
           在文字的世界中，找到一種快樂。<br>
           <br>
           無廣告，內容來源精心，<br>
           由學生使用技術公平，<br>
           網絡小說的世界得到修復，<br>
           並提供難得的閱讀體驗。<br>
           <br>
           親愛的讀者，來吧，坐下來，<br>
           喝一杯你最喜歡的飲料，<br>
           讓自己沉浸在這個如此甜蜜的世界<br>
           裡，冒險和愛情的故事在這裡相遇。<br>
           <br>
           享受你的閱讀吧，在這個明亮的地方，讓<br>
           自己沉浸在無盡黑夜的故事中。
       <div class="spacer"></div>
   
           `;
           isChanged = '1';
   
           } else {
           changeBtn.innerHTML = `翻譯成中文
           `;
           cardText.innerHTML = `
               <h5 class="card-title">Enter the World of Web Novels</h5>
                   <p class="card-text">
                   Behold, a new platform doth arrive,<br>
                   With tales of fiction that doth strive,<br>
                   To entertain and captivate the mind,<br>
                   In a world of letters, a joy to find.
                   </p>
                   <p class="card-text">
               Ad-free, with content sourced with care,<br>
               By a student using technology fair,<br>
               The world of web novels doth repair,<br>
               And offer a reading experience rare.
                   </p>
                   <p class="card-text">
               So come, dear reader, and take a seat,<br>
               With a cup of thy favored drink to heat,<br>
               And immerse thyself in this world so sweet,<br>
               Where tales of adventure and love doth meet.
                   </p>
                   <p class="card-text">
               Enjoy thy reading, in this place so bright,<br>
               And lose thyself in tales of endless night.
                   </p>
                   `;
           isChanged = '0';
           }
       });
       if (cardText) {
            cardText.innerHTML = `
                    <h5 class="card-title">Enter the World of Web Novels</h5>
                        <p class="card-text">
                        Behold, a new platform doth arrive,<br>
                        With tales of fiction that doth strive,<br>
                        To entertain and captivate the mind,<br>
                        In a world of letters, a joy to find.
                        </p>
                        <p class="card-text">
                    Ad-free, with content sourced with care,<br>
                    By a student using technology fair,<br>
                    The world of web novels doth repair,<br>
                    And offer a reading experience rare.
                        </p>
                        <p class="card-text">
                    So come, dear reader, and take a seat,<br>
                    With a cup of thy favored drink to heat,<br>
                    And immerse thyself in this world so sweet,<br>
                    Where tales of adventure and love doth meet.
                        </p>
                        <p class="card-text">
                    Enjoy thy reading, in this place so bright,<br>
                    And lose thyself in tales of endless night.
                        </p>
                        `;
                    }else {
                        console.log('cardText not found');
                      }

/*頁面載入時的各種欄位*/



const contentDiv = document.getElementById("content-nav");
const xhr = new XMLHttpRequest();
xhr.open("GET", "https://jimmy-shian.github.io/novel/nav.txt", true);
xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE || xhr.status === 200) {
        contentDiv.innerHTML = xhr.responseText;

        var novelPath = "novel";
        var href_first = "https://jimmy-shian.github.io/";

        // 檢查是否在本地端執行
        if (window.location.hostname === "localhost" || window.location.protocol === "file:") {
            // 本地端執行時，將 novelPath 設置為空字串
            novelPath = "";
            href_first = "";
        }

        // 更新網址
        const navLinks = contentDiv.querySelectorAll(".nav-link");
        navLinks.forEach(function(link) {
            var href = link.getAttribute("href");
            if (href !== "https://jimmy-shian.github.io/novel/index.html") {
                  href = href_first + novelPath + href;
              }
            link.setAttribute("href", href);
        });

        const dropdownItems = contentDiv.querySelectorAll(".dropdown-item");
        dropdownItems.forEach(function(item) {
            var href = item.getAttribute("href");
            if (href !== "https://github.com/jimmy-shian/novel") {
                  href = href_first + novelPath + href;
              }
            // href = href_first + novelPath + href;
            item.setAttribute("href", href);
        });

        // 選擇 <span> 元素並更新其內容為 currentPageNum
        const currentPageNumElement = document.getElementById('currentPageNum');

        if (currentPageNumElement !== null ) {
          currentPageNumElement.textContent = currentPageNum;
        } else {
          console.log('currentPageNum not show');
        }

        var currentPageNumElementplace = document.getElementsByClassName("currentPageNumplace")[0];

        if (currentPageNum === 0) {
          // 隐藏元素
          if (currentPageNumElementplace) {
            currentPageNumElementplace.style.display = "none";
          }
        } else {
          // 设置文本内容
          if (currentPageNumElement) {
            currentPageNumElement.textContent = currentPageNum;
          } else {
            console.log('currentPageNum not show');
          }
        }
        // $(document).ready(function() {
        //   $('.dropdown-toggle').click(function() {
        //     // 隱藏所有其他下拉選單
        //     $('.dropdown-menu').not($(this).next('.dropdown-menu')).slideUp(250);
            
        //     // 切換下拉選單的展開狀態
        //     $(this).next('.dropdown-menu').slideToggle(350); // 500毫秒的動畫時間
        //   });
        // });
      
    }
};
xhr.send();


const contentEnd = document.getElementById("content-end");

const end = new XMLHttpRequest();
end.open("GET", "https://jimmy-shian.github.io/novel/end.txt", true);
end.onreadystatechange = function() {
    if (end.readyState === XMLHttpRequest.DONE || end.status === 200) {
    contentEnd.innerHTML = end.responseText;
    //=================================================== 複製gmail
      // 選取所有具有 class "myButton" 的按鈕
      var buttons = document.querySelectorAll(".copy-p-button");
      // var ytspeed = document.querySelectorAll(".ytspeed");
      console.log('email:');
      // 為每個文字節點綁定 click 事件
      var textNodes = document.querySelectorAll(".span-copy");

      textNodes.forEach(function(textNode) {
        textNode.addEventListener("click", function() {
          var text = this.textContent.trim(); // 取得文字節點的文字內容
          copyText(text, this.nextElementSibling);
        });
      });
      // 為每個按鈕綁定 click 事件
      buttons.forEach(function(button) {
          button.addEventListener("click", function() {
              var text = this.previousElementSibling.textContent.trim(); // 取得前一個節點的文字內容
              copyText(text, this);
          });
      });

      function copyText(text, button) {
          navigator.clipboard.writeText(text).then(function() {
              if (button) {
                  button.textContent = ' ✓ Copied !'; // 修改按鈕文字為 "複製成功"
                  setTimeout(function() {
                      button.textContent = 'Copy'; // 2秒後將按鈕文字改回 "Copy"
                  }, 800);      
              }
              console.log(text);
          }).catch(function(err) {
              // window.alert("複製失敗", err);
              console.error('複製失敗', err);
          });
      }
//===================================================
    }
  };
end.send();
console.log(`contentDiv = ${contentDiv}`);
console.log(`contentEnd = ${contentEnd}`);


/*jump url*/ 
// 將主要的程式碼包裝在一個自執行函式中，以避免全域變數污染
//(function () {
    // 取得標題元素和表單元素
const titleElement = document.querySelector('h2');
  
// 如果標題元素和表單元素存在，則進一步處理
if (titleElement !== null) {
  // 從標題中解析出書名
  const title = titleElement.textContent.trim();
  const match = title.match(/《([^》]*)》/);
  const bookTitle = match ? match[1] : '';
  console.log(`bookTitle = ${bookTitle}`);
  $('#chapter').val( bookTitle );

  const formElement = document.querySelector('form:not(.side_panel_form)');

  // 取得輸入框元素和提交按鈕元素
  const numberInput = document.querySelector('#numberInput');
  // const submitButton = document.querySelector('#submitButton');
  // numberInput?.addEventListener('keyup', function(event) {
  //   if (event.keyCode = 13) {
  //     formElement.submit();
  //   }
  // });

  // 添加事件監聽器，當按下 "/" 鍵時將焦點設定在輸入框上
  document.addEventListener('keydown', function(event) {
    if (event.key === '/') {
      event.preventDefault(); // 防止斜線字符出現在輸入框中
      numberInput.focus(); // 將焦點設定在輸入框上
      numberInput.value = ''; // 清除輸入框中的值
    }
  });
  // const numberInput = document.querySelector('#numberInput');
  let shouldClearInput = true;  
  document.addEventListener('click', function(event) {
    if (shouldClearInput && numberInput === document.activeElement) {
      numberInput.value = ''; // 清除輸入框中的值
    }
  });
  numberInput.addEventListener('input', function(event) {
    shouldClearInput = false; // 禁止清除輸入框中的值
  });
  // numberInput.addEventListener('blur', function(event) {
  //   shouldClearInput = true; // 允許清除輸入框中的值
  // });

  window.addEventListener('popstate', function(event) {
    formElement.submit();
  });
  // 如果輸入框和提交按鈕存在，則設置事件監聽器
  if (numberInput !== null) {
    // 在輸入框上設置keyup事件監聽器，如果按下enter則提交表單
    // 在表單上設置submit事件監聽器，防止表單提交並重新定向網頁
    const num = new URLSearchParams(window.location.search).get('num');  // 取得 num 參數的值
    // 僅當 num 有有效值時才填入 #numberInput
    if (num) {
        $('#numberInput').val(num);
    }

    formElement?.addEventListener('submit', function(event) {
      event.preventDefault();
      const inputNumber = numberInput.value.trim();
      if (/^\d+$/.test(inputNumber)) {
        // 構造新的URL並重新定向網頁
        // window.location.href = `${bookTitle}_html${inputNumber}.html`;
        const newUrl = `${bookTitle}_html${inputNumber}.html`;
        // 檢查新的 URL 是否存在
        fetch(newUrl)
        .then(response => {
          if (response.ok) {
            // URL 存在，重新定向網頁到該 URL
            window.location.href = newUrl;
          } else {
            // 將資料夾名稱加到當前 URL
              const folderName = bookDictionary[bookTitle_js]; // 獲取對應的資料夾名稱
              if (folderName) {
                  const alternateUrl = `${window.location.origin}/${folderName}/${newUrl}`;
                  return fetch(alternateUrl); // 嘗試使用新的 URL
              } else {
                  throw new Error('資料夾名稱未找到');
              }
            }
        })
        .then(response => {
            if (response && response.ok) {
                // 如果新 URL 存在，則重新定向
                window.location.href = `${window.location.origin}/${folderName}/${newUrl}`;
            } else {
                alert('輸入章節錯誤，請重新輸入');
                // URL 不存在，重新整理頁面
                window.location.reload();
            }
        })
        .catch(error => {
            console.error('發生錯誤:', error);
            // 重新整理頁面
            window.location.reload();
        });
      } else {
          alert('請輸入有效的章節號碼');
          window.location.reload();
      }
    });
  }
};/*
const titleElement = document.querySelector('h2');
if (titleElement !== null ) { // !== null
  const title = titleElement.textContent.trim();
  const match = title.match(/《([^》]*)》/);
  const bookTitle = match ? match[1] : '';
  console.log(bookTitle);

  const form = document.querySelector('form');
  document.querySelector('#numberInput')?.addEventListener('keyup', function(event) {
      if (event.keyCode === 13) {
          form.submit();
      }
    form?.addEventListener('submit', function(event) {
      event.preventDefault();
      const numberInput = document.querySelector('#numberInput').value.trim();
      if (!/^\d+$/.test(numberInput)) {
          alert('輸入數字');
      } else {
          window.location.href = `${bookTitle}_html${numberInput}.html`;
      }
    });
    });
}*/
  //})();

/*章節總列表顯示 */
const openBtn = document.querySelector('#openBtn');
const tablelist = document.querySelector('#table-list');
const loadingIndicator = document.querySelector('#loading-indicator');
let isOpen = '0';

openBtn?.addEventListener('click', function() {
if (isOpen === '0') {
// 显示加载指示器
loadingIndicator.style.display = 'block';

const table = new XMLHttpRequest();
table.open('GET', 'table.txt', true);
table.onreadystatechange = function() {
    if (table.readyState === XMLHttpRequest.DONE) {
    // 隐藏加载指示器
    loadingIndicator.style.display = 'none';

    if (table.status === 200) {
        tablelist.innerHTML = table.responseText;
        openBtn.innerHTML = `收起章節列表
        `;
        isOpen = '1';
    } else {
        tablelist.innerHTML = '加載數據失敗，请稍后重试。';
    }
    }
};
table.send();
} else {
openBtn.innerHTML = `展開章節列表
`;
tablelist.innerHTML = `
`;
isOpen = '0';
}

});
            

/**文字內容載入 */

const contentElement = document.getElementById('content');
if (contentElement) {
  const url = window.location.href;
  // 提取URL中的文件名
  const filename = url.substring(url.lastIndexOf('/') + 1);
  // 將文件名中的HTML後綴替換為TXT後綴
  const txtname = filename.replace(".html", ".txt");
  console.log(`txtname = ${txtname}`);
  if (txtname){
    // 解碼 URL 編碼
    const decodedString = decodeURIComponent(txtname);

    // 分割字符串，只取中文部分
    const chinesePart = decodedString.split('_')[0]; // 取第一部分，即中文
    $('#chapter').val( chinesePart );
  }
  // 發送請求並匯入文件內容
  fetch(txtname)
    .then(response => {
      // 如果請求成功，插入文件內容
      if (response.ok) {
          return response.text();
      }
      // 否則拋出錯誤
      throw new Error('無法獲取內容');
    })
    .then(text => {
        contentElement.innerHTML = text;
    })
    .catch(error => {
        // 在頁面上顯示錯誤訊息
        contentElement.innerHTML = '無法獲取內容，請重新整理頁面';
    });
};

const currentUrl = window.location.href;
    // 获取当前页面链接中的数字部分
// const currentPageNum = parseInt(currentUrl.match(/html+\d+/)[0].replace('html', ''));
let currentPageNum;
try {
  currentPageNum = parseInt(currentUrl.match(/html+\d+/)[0].replace('html', ''));
  $('#message').val(currentPageNum);
} catch (error) {
  currentPageNum = 0; // 或者使用其他預設值
  console.log('Error:', error.message);
}

//==================================//
    // 左键被按下，如果当前页面不是第一页，则跳转到前一页
console.log(`currentPageNum = ${currentPageNum}`);
    function goLeft() {
      const prevPageNum = currentPageNum - 1;
      if (prevPageNum >= 1) {
        const prevUrl = currentUrl.replace(`html${currentPageNum}`, `html${prevPageNum}`);
        window.location.href = prevUrl;
      } else {
        window.location.reload();
        // window.location.href = 'https://jimmy-shian.github.io/novel/index.html';
      }
    }
    // 右键被按下，跳转到下一页
    function goRight() {
      const nextPageNum = currentPageNum + 1;
      if (nextPageNum >= 2) {
        const nextUrl = currentUrl.replace(`html${currentPageNum}`, `html${nextPageNum}`);
        window.location.href = nextUrl;
      } else {
        window.location.reload();
        // window.location.href = 'https://jimmy-shian.github.io/novel/index.html';
      }
      
    }
    // // 监听键盘事件，按下左右键时执行相应的函数
    // document.onkeydown = function (event) {
    //   if (event.key === 'ArrowLeft') { // 左键
    //     goLeft();
    //   } else if (event.key === 'ArrowRight') { // 右键
    //     goRight();
    //   }
    // };

    // 监听键盘事件，按下左右键时执行相应的函数
    document.onkeydown = function (event) {
      const searchInput = document.getElementById('numberInput');
      const isSearchInputActive = document.activeElement == searchInput;

      if (!isSearchInputActive) {
        if (event.key === 'ArrowLeft') { // 左键
          goLeft();
          // event.preventDefault(); // 阻止默认的左键行为
        } else if (event.key === 'ArrowRight') { // 右键
          goRight();
          // event.preventDefault(); // 阻止默认的右键行为
        }
      }
    };
    // 监听鼠标点击事件，左键前进，右键后退
    document.addEventListener('mousedown', function (event) {
      const searchInput = document.getElementById('numberInput');
      const isSearchInputActive = document.activeElement == searchInput;
      // 阻止浏览器的默认行为
      if (!isSearchInputActive) {
        // if (event.button === 3) { // x1
        //     goLeft();
        // } else 
        if (event.button === 4) { // x2
              event.preventDefault();
              goRight();
          }
      }
    });

    function scrollToTop() {
      window.scrollTo({
          top: 0,
          behavior: 'smooth' // 平滑滾動
      });
    }
    
    function scrollToBottom() {
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth' // 平滑滾動
        });
    }

    // 監聽視窗滾動事件
    window.addEventListener('scroll', function() {
      var backToTop = document.getElementById('back-to-top');
      var scrollToBottom = document.getElementById('scroll-to-bottom');
      var scrollPosition = window.pageYOffset;

      if (scrollPosition >= document.body.scrollHeight - window.innerHeight) {
        // 在最底時，只顯示回到最頂按鍵，隱藏滾動到最底按鍵
        backToTop.style.display = 'block';
        scrollToBottom.style.display = 'none';
      } else if (scrollPosition > 50) {
        // 在中間時，兩個按鍵都顯示
        backToTop.style.display = 'block';
        scrollToBottom.style.display = 'block';
      } else {
        // 在最頂時，只顯示滾動到最底按鍵，隱藏回到最頂按鍵
        backToTop.style.display = 'none';
        scrollToBottom.style.display = 'block';
      }
    });

      // 使用jQuery綁定點擊事件==========================================================
window.onload = function() {

// document.addEventListener('DOMContentLoaded', function() {
  $(document).click(function(event) {
    // 如果點擊事件的目標不在下拉選單或下拉選單的觸發元素上，則關閉所有下拉選單
    if (!$(event.target).hasClass('dropdown-toggle') && !$(event.target).hasClass('dropdown-menu')) {
      $('.dropdown-menu').slideUp(250);
    }
  });

  // 使用jQuery綁定點擊事件
  $('.dropdown-toggle').click(function() {
    // 隱藏所有其他下拉選單
    $('.dropdown-menu').not($(this).next('.dropdown-menu')).slideUp(250);
    
    // 切換下拉選單的展開狀態
    $(this).next('.dropdown-menu').slideToggle(350); // 500毫秒的動畫時間
  });
// });
};

     
// 側邊攔 Start

//$(document).ready(function () {

  const sidePanelContainer_js = document.getElementById('side_panel_container');
  const sidePanelToggle_js = document.getElementById('side_panel_toggle');
  const overlay_js = document.getElementById('overlay');

  // 切換側邊欄顯示狀態
  function toggleSidePanel() {
      const isOpen_js = sidePanelContainer_js.classList.contains('open');
      if (isOpen_js) {
          sidePanelContainer_js.classList.remove('open');
          overlay_js.classList.remove('active');
          sidePanelToggle_js.innerHTML = String.fromCodePoint(0x1F87A); // 展開箭頭
      } else {
          sidePanelContainer_js.classList.add('open');
          overlay_js.classList.add('active');
          sidePanelToggle_js.innerHTML = String.fromCodePoint(0x1F878); // 收回箭頭
      }
  }

  // 點擊箭頭按鈕切換側邊欄
  sidePanelToggle_js.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidePanel();
  });

  // 點擊空白處縮回側邊欄
  overlay_js.addEventListener('click', toggleSidePanel);

  function togglePasswordVisibility() {
      const passwordField_js = document.getElementById('password');
      const passwordIcon_js = document.getElementById('password_icon');

      if (passwordField_js.type === 'password') {
          passwordField_js.type = 'text';
          passwordIcon_js.src = 'https://jimmy-shian.github.io/novel/picture/hide_password.png'; // 切換為「隱藏密碼」圖片
          passwordIcon_js.alt = '隱藏密碼';
      } else {
          passwordField_js.type = 'password';
          passwordIcon_js.src = 'https://jimmy-shian.github.io/novel/picture/show_password.png'; // 切換為「顯示密碼」圖片
          passwordIcon_js.alt = '顯示密碼';
      }
  }

  const submitButton_js = document.getElementById('submit_button');
  const chapterInput_js = document.getElementById('message');
  const chapternameInput_js = document.getElementById('chapter');

  // 在輸入框獲得焦點時生成隨機書名

  chapternameInput_js.addEventListener('focus', function() {
    const randomTitles = getRandomBookTitles(bookDictionary, Math.floor(Math.random() * 3) + 5); // 隨機 5 到 7 個書名
    chapternameInput_js.value = randomTitles.join(', '); // 更新輸入框的值
  });

  // 記錄當前模式
  let currentMode_js = 'save';

  $('#query_button').on('click', function () {
      submitButton_js.textContent = '查詢';
      chapterInput_js.disabled = true; // 禁止輸入

      currentMode_js = 'query';
      //toggleFormMode(currentMode);
  });

  $('#save_button').on('click', function () {
      submitButton_js.textContent = '儲存';
      chapterInput_js.disabled = false; // 儲存模式允許輸入

      currentMode_js = 'save';
      //toggleFormMode(currentMode);
  });

  $('#submit_button').on('click', function (event) {
      event.preventDefault(); // 阻止表單的預設提交行為
      // 檢查按鈕的文字內容
      if (submitButton_js.textContent === "前往") {
          // 跳轉到 YouTube
          const inputNumber_js = $('#message').val().trim();
          const bookTitle_js = $('#chapter').val().trim();
          if (/^\d+$/.test(inputNumber_js)) {
            // 構造新的URL並重新定向網頁
            const newUrl = `${bookTitle_js}_html${inputNumber_js}.html`;
            // 檢查新的 URL 是否存在
            fetch(newUrl)
            .then(response => {
              if (response.ok) {
                // URL 存在，重新定向網頁到該 URL
                window.location.href = newUrl;
              } else {
                alert('輸入章節錯誤，請重新輸入');
                // URL 不存在，重新整理頁面
                window.location.reload();
              }
            })
            .catch(error => {
              console.error('發生錯誤:', error);
              // alert('輸入章節錯誤，請重新輸入');
              // 重新整理頁面
              window.location.reload();
            });
            // window.location.href = newUrl;
          } else {
            // 彈出提示框
            alert('輸入章節錯誤，請重新輸入');
            // 在當前頁面重新整理
            window.location.reload();
            // window.location.href = 'https://jimmy-shian.github.io/novel/404.html';
          }

      } else {
          // 如果不是「前往」，則執行查詢或儲存操作
          toggleFormMode(currentMode_js);
      }
  });

  function toggleFormMode(mode) {
      var url_js = 'https://script.google.com/macros/s/AKfycbwfajf6Lv4_r4wdcbswpxMFtLtxjp6ZxWZ9RI_FLvmf7oIAlY_rILxgmC5zQeRtDRJ6/exec';
      var user_js = $('#user').val().trim();
      var password_js = $('#password').val().trim();
      var chapter_js = $('#chapter').val().trim();
      var message_js = $('#message').val().trim();
      if (message_js == '0' || message_js == '') {
        // 如果 message_js 是 '0' 或空值，保持輸入框是空值
        $('#message').val(''); // 可以選擇性地設置輸入框為空
       }
       
      // 檢查必填欄位
      if (!user_js || !password_js || !chapter_js) {
          alert('請填寫帳號、密碼和書名！'); // 提示用戶填寫必要的欄位
          return; // 資料不完整，禁止執行後續操作
      }

      // 在儲存模式下，檢查 message 是否有數值
      if (mode === 'save' && !message_js) {
          alert('請填寫章節！'); // 提示用戶填寫章節
          return; // 資料不完整，禁止執行後續操作
      }

      if (mode === 'query') {
          let dotCount_js = 0; // 點點計數器
          chapterInput_js.value = "查詢中";

          // 啟動點點動畫，每500毫秒切換一次
          const animationInterval_js = setInterval(() => {
              dotCount_js = (dotCount_js + 1) % 4; // 計算點點數量(0,1,2,3循環)
              chapterInput_js.value = "查詢中" + ".".repeat(dotCount_js); // 更新input內容
          }, 500);

          $.get(url_js, {
                  user: user_js,
                  password: password_js,
                  chapter: chapter_js
              },
              function (data) {
                  if (data.status == 'success') {
                      clearInterval(animationInterval_js); // 停止動畫
                      chapterInput_js.value = data.message; // 查詢成功後顯示訊息
                      submitButton_js.textContent = '前往';
                  } else if (data.status == 'error') {
                      clearInterval(animationInterval_js); // 停止動畫
                      chapterInput_js.value = data.message; // 清除查詢中的文字
                      submitButton_js.textContent = '查詢';
                  }
              }
          ).fail(function (error) {
              alert(`${error.message}`);
          });

      } else if (mode === 'save') {
          // 禁用按鈕，並添加抖動效果
          submitButton_js.disabled = true;
          submitButton_js.classList.add('shake');
          submitButton_js.textContent = '儲存中';

          $.post(url_js, {
                  user: user_js,
                  password: password_js,
                  chapter: chapter_js,
                  msg: message_js
              },
              function (data) {
                  if (data.status == 'success') {
                      alert(`${user_js} save "${message_js}" successfully`);
                  } else if (data.status == 'error') {
                      alert(`!!~ ${data.message}`);
                  }
                  submitButton_js.textContent = '儲存';
                  // 移除抖動效果並重新啟用按鈕
                  submitButton_js.classList.remove('shake');
                  submitButton_js.disabled = false;
              }
          ).fail(function (error) {
              // 當請求失敗時，移除抖動效果並重新啟用按鈕
              submitButton_js.textContent = '儲存';
              alert(`!!~ ${error.message}`);
              submitButton_js.classList.remove('shake');
              submitButton_js.disabled = false;
          });
      }
  }

//});

// 側邊攔 End


// 取得所有的變數名稱和值
const constVariables = Object.entries(window)
  .filter(([name, value]) => typeof value !== 'function')
  .filter(([name, value]) => Object.is(value, window[name]))
  .filter(([name, value]) => document.querySelector(`[data-const="${name}"]`) !== null)
  .filter(([name, value]) => value !== null);

// 顯示變數名稱和值
constVariables.forEach(([name, value]) => {
  console.log(`${name}: ${value}`);
});

// };
//})(); 