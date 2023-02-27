   // 翻譯index
    const cardText = document.querySelector('#cardText');
    const changeBtn = document.querySelector('#changeBtn');
   
   console.log(changeBtn);
   console.log(cardText);
   
   let isChanged = '0';
           
       changeBtn.addEventListener('click', function changeindextex() {
           if (isChanged === '0') {
           changeBtn.innerHTML = `翻譯成英文
           `;
           cardText.innerHTML = `
           <h4 class="card-title">進入網絡小說世界~</h4>
           
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
           裡，冒險和愛情的故事在這里相遇。<br>
           <br>
           享受你的閱讀吧，在這個明亮的地方，讓<br>
           自己沉浸在無盡黑夜的故事中。
       <div class="spacer"></div>
   
           `;
           isChanged = '1';
   
           } else {
           changeBtn.innerHTML = `Translate to Chinese
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

window.onload = function() {

};
const contentDiv = document.getElementById("content-nav");
const xhr = new XMLHttpRequest();
xhr.open("GET", "https://jimmy-shian.github.io/novel/nav.txt", true);
xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE || xhr.status === 200) {
    contentDiv.innerHTML = xhr.responseText;
    }
};
xhr.send();

const contentEnd = document.getElementById("content-end");

const end = new XMLHttpRequest();
end.open("GET", "https://jimmy-shian.github.io/novel/end.txt", true);
end.onreadystatechange = function() {
    if (end.readyState === XMLHttpRequest.DONE || end.status === 200) {
    contentEnd.innerHTML = end.responseText;
    }
};
end.send();
console.log(contentDiv);
console.log(contentEnd);


const title = document.querySelector('h2').textContent.trim();
const match = title.match(/《([^》]*)》/);
const bookTitle = match ? match[1] : '';
console.log(bookTitle);

const form = document.querySelector('form');
form.addEventListener('submit', function(event) {
    event.preventDefault();
    const numberInput = document.querySelector('#numberInput').value.trim();
    if (!/^\d+$/.test(numberInput)) {
        alert('輸入數字');
    } else {
        window.location.href = `${bookTitle}_html${numberInput}.html`;
    }
});

document.querySelector('#numberInput').addEventListener('keyup', function(event) {
    if (event.keyCode === 13) {
        form.submit();
    }
});

const openBtn = document.querySelector('#openBtn');
const tablelist = document.querySelector('#table-list');
const loadingIndicator = document.querySelector('#loading-indicator');
let isOpen = '0';

openBtn.addEventListener('click', function() {
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
                